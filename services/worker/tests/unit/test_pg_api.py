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
