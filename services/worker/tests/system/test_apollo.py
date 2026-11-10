import pytest,httpx
from career.integrations.apollo import search_employees

@pytest.mark.asyncio
async def test_apollo_people_search_only_accepts_current_company_match():
    payload={'people':[{'name':'Alex Example','title':'Engineering Manager','linkedin_url':'https://www.linkedin.com/in/alex-example','organization':{'primary_domain':'alpha.com'}},{'name':'Previous Employee','title':'Engineer','linkedin_url':'https://www.linkedin.com/in/ex','organization':{'primary_domain':'other.com'}}]}
    def handler(req):
        assert req.url.path=='/api/v1/mixed_people/api_search'
        assert 'alpha.com' in str(req.url)
        return httpx.Response(200,json=payload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        people=await search_employees(client,'key','alpha.com')
    assert len(people)==1 and people[0]['name']=='Alex Example'

@pytest.mark.asyncio
async def test_apollo_requires_explicit_key():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={}))) as client:
        with pytest.raises(ValueError):await search_employees(client,'','alpha.com')

@pytest.mark.asyncio
async def test_people_worker_can_use_apollo_when_official_team_page_missing(tmp_path,monkeypatch):
    from career.platform import CareerPlatform
    from career.people_worker import run_people_queue
    monkeypatch.setenv('APOLLO_API_KEY','test-api-key')
    def handler(req):
        if req.url.host=='api.apollo.io':
            return httpx.Response(200,json={'people':[{'name':'Alex Example','title':'Engineering Manager','linkedin_url':'https://www.linkedin.com/in/alex','organization':{'primary_domain':'alpha.com'}}]})
        return httpx.Response(404)
    with CareerPlatform(tmp_path/'db') as platform:
        jid=platform.record_job(source='test',source_job_id='a',company_name='Alpha',company_domain='alpha.com',title='SWE',description='Remote',apply_url='https://alpha.com/jobs/a',remote_text='remote',published_at=None)
        platform.set_eligibility(jid,'verified_eligible','Can hire from Nigeria','https://alpha.com/policy')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result=await run_people_queue(platform,client)
        assert result['researched']==1
        assert len(platform.contacts(platform.get_job(jid)['company_id']))==1
