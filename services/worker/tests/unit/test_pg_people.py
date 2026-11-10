import httpx
import pytest
from career.persistence.pg_people import run_pg_people


class StubCatalog:
    def __init__(self, domain='example.com'):
        self.domain=domain
        self.people=[]
        self.completed=[]
    def pending_people(self,limit=10):
        return [{'id':'task-1','company_id':'company-1','canonical_domain':self.domain}]
    def add_contact(self,company_id,contact):
        self.people.append((company_id,contact))
    def resolve_people_task(self,task_id,state):
        self.completed.append((task_id,state))


@pytest.mark.asyncio
async def test_pg_people_collects_only_public_provenanced_person_profiles():
    html='''<script type="application/ld+json">{"@type":"Person","name":"A Engineer",
    "jobTitle":"Engineering Manager","url":"https://example.com/team/engineer"}</script>'''
    catalog=StubCatalog()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,text=html))) as client:
        result=await run_pg_people(catalog,client)
    assert result['researched']==1
    assert len(catalog.people)==1
    assert catalog.people[0][1]['profile_url']=='https://example.com/team/engineer'
    assert catalog.completed==[('task-1','completed')]


@pytest.mark.asyncio
async def test_pg_people_does_not_fetch_internal_hosts():
    catalog=StubCatalog('localhost')
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:pytest.fail('no internal fetch'))) as client:
        result=await run_pg_people(catalog,client)
    assert result['researched']==0
    assert catalog.completed==[('task-1','blocked')]
