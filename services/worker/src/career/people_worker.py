"""Bounded contact research on company-controlled public structured-data pages.

No private-profile scraping, guesses at emails, or paid enrichment.
"""
from __future__ import annotations
from ipaddress import ip_address
import os
from career.integrations.apollo import search_employees
from urllib.parse import urlsplit
import httpx
from career.agents import parse_contact_candidates


def _safe_public_domain(domain:str)->bool:
    if not domain or domain.casefold() in ('localhost','localhost.localdomain') or domain.casefold().endswith(('.local','.internal','.localhost')):
        return False
    if any(x in domain for x in ('@','/','\\',':','#','?')):return False
    try:
        return ip_address(domain).is_global
    except ValueError:
        return '.' in domain and all(p for p in domain.split('.'))


async def run_people_queue(platform,client:httpx.AsyncClient,limit:int=10)->dict:
    """Process eligible companies; failures remain retryable and never mark complete."""
    count=0;errors=[]
    for task in platform.pending_research("people")[:max(0,min(limit,100))]:
        cid=task['subject_id'];company=platform.db.execute('SELECT domain FROM companies WHERE id=?',(cid,)).fetchone()
        if not company or not _safe_public_domain(company['domain']):
            errors.append({'company_id':cid,'error':'no safe verified company domain'})
            continue
        url=f"https://{company['domain']}/team"
        people=[]
        official_error=None
        try:
            response=await client.get(url,timeout=15,follow_redirects=False)
            response.raise_for_status()
            if len(response.content)>1024*1024:raise ValueError('response too large')
            people=parse_contact_candidates(response.text,url)[:5]
        except (httpx.HTTPError,ValueError) as error:
            official_error=type(error).__name__
        api_key=os.environ.get('APOLLO_API_KEY','')
        if len(people)<5 and api_key:
            try:
                apollo=await search_employees(client,api_key,company['domain'],5-len(people))
                people.extend(apollo)
            except (httpx.HTTPError,ValueError) as error:
                errors.append({'company_id':cid,'source':'apollo','error':type(error).__name__})
        for contact in people[:5]:
            platform.add_contact(cid,contact['name'],contact['title'],contact['profile_url'])
        if people or official_error is None:
            platform.db.execute("UPDATE research_queue SET status='completed' WHERE id=? AND status='pending'",(task['id'],))
            platform._event('people_research_complete',cid,{'source':url,'contacts':len(people)})
            count+=1
        else:
            # No available provider; do not repeatedly hammer missing /team pages.
            platform.db.execute("UPDATE research_queue SET status='blocked' WHERE id=? AND status='pending'",(task['id'],))
            errors.append({'company_id':cid,'error':official_error or 'no_contact_source'})
    return {'researched':count,'errors':errors}
