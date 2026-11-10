"""Official job posting research with explicit evidence and bounded fetches.

This worker deliberately does not treat anonymous forum posts as verified
hiring policy. Unknown jobs remain in review queues.
"""
from __future__ import annotations
import re
import httpx
from html import unescape
from urllib.parse import urlsplit
from career.agents import Evidence,classify_employer_evidence
from career.people_worker import _safe_public_domain


def _plain(html:str)->str:
    # Only non-executable text participates in rule checks.
    html=re.sub(r'<(script|style)\b[^>]*>.*?</\1>',' ',html,flags=re.I|re.S)
    return unescape(re.sub(r'<[^>]*>',' ',html))[:100000]


async def run_eligibility_queue(platform,client:httpx.AsyncClient,limit:int=30)->dict:
    count=0;errors=[]
    for task in platform.pending_research('eligibility')[:max(0,min(limit,100))]:
        job=platform.get_job(task['subject_id'])
        url=job['apply_url'];host=urlsplit(url).hostname
        if not _safe_public_domain(host or ''):
            errors.append({'job_id':job['id'],'error':'untrusted url'});continue
        try:
            response=await client.get(url,timeout=20,follow_redirects=False)
            response.raise_for_status()
            if len(response.content)>1_000_000:raise ValueError('response too large')
            official=Evidence(source_url=url,kind='posting',text=_plain(response.text),scope='job')
            decision=classify_employer_evidence((job['description'] or '')+' '+(job['remote_text'] or ''),[official])
            platform.set_eligibility(job['id'],decision.status,'; '.join(decision.reasons),url)
            platform.db.execute("UPDATE research_queue SET status='completed' WHERE id=?",(task['id'],))
            count+=1
        except (httpx.HTTPError,ValueError) as e:
            errors.append({'job_id':job['id'],'error':type(e).__name__})
    return {'researched':count,'errors':errors}
