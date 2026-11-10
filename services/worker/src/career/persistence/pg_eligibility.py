"""Conservative source-grounded eligibility research for the PostgreSQL catalog."""
from urllib.parse import urlsplit
import httpx
from career.agents import Evidence, classify_employer_evidence
from career.eligibility_worker import _plain
from career.people_worker import _safe_public_domain


async def run_pg_eligibility(catalog, client: httpx.AsyncClient, *, limit: int = 30) -> dict:
    if not 1 <= limit <= 100:
        raise ValueError('eligibility limit must be 1..100')
    results={'researched':0,'source_failures':[]}
    for job in catalog.pending_eligibility(limit=limit):
        url=str(job['apply_url'])
        parsed=urlsplit(url)
        if parsed.scheme!='https' or not _safe_public_domain(parsed.hostname or ''):
            results['source_failures'].append({'job_id':str(job['id']),'error':'untrusted_url'})
            continue
        try:
            response=await client.get(url,timeout=20,follow_redirects=False)
            response.raise_for_status()
            if len(response.content)>1_000_000:
                raise ValueError('posting too large')
            evidence=_plain(response.text)
            decision=classify_employer_evidence(
                ' '.join([job['title'],job.get('remote_text') or '']),
                [Evidence(source_url=url,kind='posting',text=evidence,scope='job')])
            catalog.assess_job(str(job['id']),status=decision.status,source_url=url,
                               excerpt=evidence[:4000],confidence=decision.confidence)
            results['researched']+=1
        except (httpx.HTTPError,ValueError) as exc:
            results['source_failures'].append({'job_id':str(job['id']),'error':type(exc).__name__})
    return results
