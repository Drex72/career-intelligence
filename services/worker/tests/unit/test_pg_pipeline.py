from datetime import datetime, timezone
import httpx
import pytest

from career.persistence.pg_pipeline import run_pg_discovery


class FakeCatalog:
    def __init__(self):
        self.jobs=[]
        self.sources=[]
    def upsert_job(self,**kwargs):
        self.jobs.append(kwargs)
        return 'job-1'


@pytest.mark.asyncio
async def test_feed_ingestion_persists_only_candidates_and_never_calls_gmail():
    c=FakeCatalog()
    def transport(request):
        assert request.url.host=='remotive.com'
        return httpx.Response(200,json={'jobs':[{
            'id':341,'company_name':'Good Company','title':'Backend Engineer',
            'description':'Remote role','url':'https://good.example/jobs/341',
            'candidate_required_location':'Worldwide','publication_date':'2026-11-10T10:00:00Z'}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        report=await run_pg_discovery(c,client,['backend'],now=datetime(2026,11,10,11,tzinfo=timezone.utc),board_limit=0)
    assert report['processed_jobs']==1
    assert len(c.jobs)==1
    assert c.jobs[0]['source']=='remotive'
    assert c.jobs[0]['company_name']=='Good Company'
    assert not hasattr(c,'send_email')


@pytest.mark.asyncio
async def test_discovery_reports_rate_limits_without_discarding_whole_run():
    c=FakeCatalog()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(429))) as client:
        report=await run_pg_discovery(c,client,['backend'],board_limit=0)
    assert report['processed_jobs']==0
    assert report['source_failures'][0]['source']=='remotive'
