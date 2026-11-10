from uuid import uuid4
import httpx
import pytest
from career.pg_api import make_pg_app


class StubAuth:
    def __init__(self,owner):self.owner=owner
    async def verify(self,token):
        if token!='valid':
            from fastapi import HTTPException
            raise HTTPException(status_code=401)
        return self.owner


class StubCatalog:
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def metrics(self,owner):return {'jobs':9,'companies':3,'delivered':1}
    def list_batch(self,owner,day):return [{'title':'Backend Engineer','job_id':'j','company_name':'Acme'}]


@pytest.mark.asyncio
async def test_pg_api_requires_owner_auth_for_metrics_and_opportunities():
    owner=uuid4()
    app=make_pg_app('fake-dsn',StubAuth(owner),store_factory=lambda dsn:StubCatalog())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        assert (await client.get('/api/ci/metrics')).status_code==401
        ok=await client.get('/api/ci/metrics',headers={'Authorization':'Bearer valid'})
        assert ok.status_code==200 and ok.json()['jobs']==9
        batch=await client.get('/api/ci/batches/2026-11-10',headers={'Authorization':'Bearer valid'})
        assert batch.status_code==200 and batch.json()['items'][0]['company_name']=='Acme'
        assert (await client.get('/api/ci/batches/2026-11-10')).status_code==401


@pytest.mark.asyncio
async def test_pg_api_owner_scoped_sections_and_manual_application():
    from datetime import datetime
    owner=uuid4()
    class FullStub(StubCatalog):
        def list_jobs(self,limit=100):return [{'id':'job-1','title':'Backend Engineer'}]
        def list_contacts(self,limit=100):return [{'id':'person-1','name':'Alex Engineer'}]
        def list_applications(self,owner):return [{'id':'app-1','status':'applied'}]
        def list_knowledge_index(self):return [{'path':'01-experience/example.md'}]
        def list_outreach(self,owner):return [{'id':'draft-1','status':'draft'}]
        def operations(self):return {'pending':2}
        def record_application(self,owner,job_id,status,notes=''):
            assert owner==user
            assert status=='applied'
            return 'app-1'
    user=owner
    app=make_pg_app('fake-dsn',StubAuth(owner),store_factory=lambda dsn:FullStub())
    h={'Authorization':'Bearer valid'}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        for path,key in [('/api/ci/jobs','jobs'),('/api/ci/people','contacts'),
            ('/api/ci/applications','applications'),('/api/ci/knowledge','documents'),
            ('/api/ci/outreach','drafts'),('/api/ci/operations','states')]:
            denied=await client.get(path)
            assert denied.status_code==401
            allowed=await client.get(path,headers=h)
            assert allowed.status_code==200 and key in allowed.json()
        invalid=await client.post('/api/ci/applications',headers=h,json={'job_id':str(uuid4()),'status':'invalid'})
        assert invalid.status_code==422
        valid=await client.post('/api/ci/applications',headers=h,json={'job_id':str(uuid4()),'status':'applied'})
        assert valid.status_code==200 and valid.json()['id']=='app-1'
