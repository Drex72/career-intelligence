"""Optional credit-free Apollo People API Search. No email enrichment here."""
from urllib.parse import urlsplit
import httpx

API='https://api.apollo.io/api/v1/mixed_people/api_search'

async def search_employees(client:httpx.AsyncClient,api_key:str,domain:str,limit:int=5)->list[dict]:
    if not api_key:raise ValueError('Apollo API key required')
    if not domain or '/' in domain:raise ValueError('verified employer domain required')
    params=[('q_organization_domains_list[]',domain),('person_titles[]','Engineering Manager'),('person_titles[]','Software Engineer'),('person_titles[]','Technical Recruiter'),('page','1'),('per_page',str(min(25,max(1,limit*3))))]
    r=await client.post(API,params=params,headers={'x-api-key':api_key,'Accept':'application/json'},timeout=20)
    r.raise_for_status()
    results=[]
    for person in r.json().get('people',[]):
        org=person.get('organization') or {}
        current=(org.get('primary_domain') or urlsplit(org.get('website_url') or '').hostname or '').lower().removeprefix('www.')
        if current!=domain.lower().removeprefix('www.'):continue
        name=person.get('name');title=person.get('title');url=person.get('linkedin_url')
        if not (name and title and url and urlsplit(url).scheme=='https'):continue
        results.append({'name':name,'title':title,'profile_url':url,'source':'apollo_people_search'})
        if len(results)>=limit:break
    return results
