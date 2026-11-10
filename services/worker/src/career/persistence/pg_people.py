"""Bounded, source-backed research on a company's own public team pages."""
from __future__ import annotations
import httpx
from career.people_worker import _safe_public_domain
from career.agents import parse_contact_candidates


async def run_pg_people(catalog, client: httpx.AsyncClient, *, limit: int = 10) -> dict:
    if not 1<=limit<=20:
        raise ValueError('people research limit must be 1..20')
    report={'researched':0,'people_added':0,'source_failures':[]}
    for item in catalog.pending_people(limit):
        domain=item['canonical_domain']
        if not _safe_public_domain(domain or ''):
            catalog.resolve_people_task(item['id'],'blocked')
            report['source_failures'].append({'task_id':str(item['id']),'error':'unverified_domain'})
            continue
        url=f'https://{domain}/team'
        try:
            response=await client.get(url,follow_redirects=False,timeout=15)
            response.raise_for_status()
            if len(response.content)>1_000_000:
                raise ValueError('public page too large')
            contacts=parse_contact_candidates(response.text,url)[:5]
            for contact in contacts:
                catalog.add_contact(item['company_id'],contact)
                report['people_added']+=1
            catalog.resolve_people_task(item['id'],'completed')
            report['researched']+=1
        except (httpx.HTTPError,ValueError) as err:
            catalog.resolve_people_task(item['id'],'blocked')
            report['source_failures'].append({'task_id':str(item['id']),'error':type(err).__name__})
    return report
