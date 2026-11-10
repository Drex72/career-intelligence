from datetime import datetime, timezone
import httpx
import pytest
from career.api import make_app
from career.pipeline import ingest_board, normalize_remote_feed
from career.mailer import GmailDispatcher
from career.platform import CareerPlatform

@pytest.mark.asyncio
async def test_api_requires_auth_and_can_read_dashboard(tmp_path):
    app=make_app(database=tmp_path/'web.sqlite',token='sample-secret',owner='owner')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        r=await client.get('/api/metrics')
        assert r.status_code==401
        r=await client.get('/api/metrics',headers={'Authorization':'Bearer sample-secret'})
        assert r.status_code==200 and r.json()['jobs']==0
        r=await client.get('/api/jobs',headers={'Authorization':'Bearer sample-secret'})
        assert r.status_code==200 and r.json()==[]

@pytest.mark.asyncio
async def test_board_ingestion_deduplicated(tmp_path):
    now=datetime(2026,11,10,tzinfo=timezone.utc)
    def endpoint(request):
        return httpx.Response(200,json=[{'id':'123','text':'Backend Engineer','descriptionPlain':'Remote worldwide; Python','hostedUrl':'https://jobs.lever.co/alpha/123','workplaceType':'remote','createdAt':1794200000000}])
    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        with CareerPlatform(tmp_path/'db') as platform:
            platform.add_board('lever','alpha','Alpha','alpha.com')
            assert await ingest_board(platform,platform.boards()[0],client,now)==1
            assert await ingest_board(platform,platform.boards()[0],client,now)==0
            assert len(platform.jobs())==1


def test_remote_feed_normalization():
    feed={'jobs':[{'id':12,'company_name':'Alpha','title':'Backend Engineer','description':'Global remote','url':'https://example.com/apply','publication_date':'2026-11-10T00:00:00Z'}]}
    result=normalize_remote_feed(feed,datetime(2026,11,10,tzinfo=timezone.utc))
    assert result[0].company_name=='Alpha'
    assert result[0].source=='remotive'


def test_gmail_dispatcher_refuses_unapproved_and_reconciles(tmp_path):
    sent=[]
    with CareerPlatform(tmp_path/'db') as platform:
        job=platform.record_job(source='test',source_job_id='j',company_name='One',company_domain='one.com',title='SWE',description='Remote',apply_url='https://one.com/jobs/j',remote_text='remote',published_at=None)
        platform.record_application('owner',job,'applied')
        cid=platform.add_contact(platform.get_job(job)['company_id'],'Recruiter','Recruiter','https://one.com/team','recruiter@one.com',True)
        d=platform.draft_email('owner',job,cid,'Hello','Thanks for reading this')
        dispatcher=GmailDispatcher(platform,lambda email,subject,body,key: sent.append((email,subject,key)) or 'gmail-1')
        assert dispatcher.send(d) is False
        assert platform.authorize_message(d,'manual')
        assert dispatcher.send(d) is True
        assert dispatcher.send(d) is False
        assert len(sent)==1
        assert platform.dispatch_status(d)=='sent'

@pytest.mark.asyncio
async def test_outreach_api_is_auth_protected_and_approval_requires_application(tmp_path):
    app=make_app(database=tmp_path/'web.db',token='sample-secret',owner='owner')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        r=await client.get('/api/outreach')
        assert r.status_code==401
        r=await client.get('/api/outreach',headers={'Authorization':'Bearer sample-secret'})
        assert r.status_code==200 and r.json()==[]
        r=await client.get('/api/research/queue',headers={'Authorization':'Bearer sample-secret'})
        assert r.status_code==200 and r.json()==[]
        r=await client.get('/api/knowledge/notes',headers={'Authorization':'Bearer sample-secret'})
        assert r.status_code==200 and r.json()==[]
