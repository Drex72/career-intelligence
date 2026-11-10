from datetime import datetime,timezone
import httpx
import pytest
from career.platform import CareerPlatform
from career.eligibility_worker import run_eligibility_queue

@pytest.mark.asyncio
async def test_job_research_promotes_verified_and_triggers_people(tmp_path):
    with CareerPlatform(tmp_path/'db') as platform:
        job=platform.record_job(source='test',source_job_id='job',company_name='Example',company_domain='example.com',title='Backend engineer',description='Remote role. Python.',apply_url='https://example.com/jobs/1',remote_text='Remote',published_at=datetime.now(timezone.utc).isoformat())
        assert any(t['kind']=='eligibility' for t in platform.pending_research())
        def serve(request):return httpx.Response(200,text='For this role, remote applicants residing in Nigeria are eligible. We can employ applicants residing in Nigeria.')
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            result=await run_eligibility_queue(platform,client)
        assert result['researched']==1
        assert platform.get_job(job)['eligibility']=='verified_eligible'
        assert any(t['kind']=='people' for t in platform.pending_research())

@pytest.mark.asyncio
async def test_no_promotion_for_ambiguous_remote(tmp_path):
    with CareerPlatform(tmp_path/'db') as platform:
        job=platform.record_job(source='test',source_job_id='job',company_name='Example',company_domain='example.com',title='Backend engineer',description='Remote.',apply_url='https://example.com/jobs/1',remote_text='Remote',published_at=None)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,text='Remote engineering job'))) as client:
            await run_eligibility_queue(platform,client)
        assert platform.get_job(job)['eligibility']!='verified_eligible'
