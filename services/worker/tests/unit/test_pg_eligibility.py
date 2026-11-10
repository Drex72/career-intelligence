import httpx
import pytest
from career.persistence.pg_eligibility import run_pg_eligibility


class FakeCatalog:
    def __init__(self):
        self.assessments=[]
    def pending_eligibility(self,limit=30):
        return [{'id':'job-1','apply_url':'https://company.example/jobs/one',
                 'title':'Remote Backend Engineer','remote_text':'Remote'}]
    def assess_job(self,job_id,**kwargs):
        self.assessments.append({'job_id':job_id,**kwargs})


@pytest.mark.asyncio
async def test_pg_research_does_not_verify_ambiguous_remote():
    cat=FakeCatalog()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(200,text='<p>Remote work possible.</p>'))) as client:
        result=await run_pg_eligibility(cat,client)
    assert result['researched']==1
    assert cat.assessments[0]['status'] != 'verified_eligible'


@pytest.mark.asyncio
async def test_pg_research_preserves_official_nigeria_evidence():
    cat=FakeCatalog()
    text='<p>This role is remote, and applicants residing in Nigeria are eligible. We can employ people residing in Nigeria.</p>'
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(200,text=text))) as client:
        result=await run_pg_eligibility(cat,client)
    assert result['researched']==1
    assert cat.assessments[0]['status']=='verified_eligible'
    assert cat.assessments[0]['source_url']=='https://company.example/jobs/one'


@pytest.mark.asyncio
async def test_pg_research_rejects_localhost_and_does_not_assess():
    cat=FakeCatalog()
    cat.pending_eligibility=lambda limit=30:[{'id':'evil','apply_url':'http://127.0.0.1/admin', 'title':'Engineer','remote_text':''}]
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:pytest.fail('must not request local urls'))) as client:
        result=await run_pg_eligibility(cat,client)
    assert result['researched']==0
    assert not cat.assessments
