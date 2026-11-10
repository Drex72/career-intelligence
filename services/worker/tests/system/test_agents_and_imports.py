import pytest
from pathlib import Path
from datetime import datetime, timezone
from career.agents import Evidence, classify_employer_evidence, score_match, build_outreach, parse_contact_candidates, classify_reply
from career.integrations.simplify_csv import read_application_csv, export_application_csv


def test_official_eligibility_and_unverified_community_claim():
    direct=[Evidence(source_url='https://employer.test/hiring',kind='official',text='This role is remote and we can employ applicants residing in Nigeria.',scope='job')]
    outcome=classify_employer_evidence('Remote engineering',direct)
    assert outcome.status=='verified_eligible'
    forum=[Evidence(source_url='https://reddit.com/r/jobs/x',kind='community',text='I heard they hire anywhere including Nigeria.',scope='company')]
    assert classify_employer_evidence('Remote engineering',forum).status!='verified_eligible'
    conflict=[Evidence(source_url='https://employer.test/jobs/x',kind='posting',text='This role is US only. Applicants must reside in the United States.',scope='job')]
    assert classify_employer_evidence('Remote engineering',direct+conflict).status=='ineligible'


def test_rank_experience_without_unsupported_claims():
    result=score_match('Python backend infrastructure engineer', 'Built Python backend APIs and infrastructure systems')
    assert result.score>0
    assert 'python' in result.matched


def test_contact_discovery_from_structured_public_page():
    html='''<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Alex Example","jobTitle":"Engineering Manager","url":"https://company.test/team/alex"}</script>'''
    people=parse_contact_candidates(html, 'https://company.test/team')
    assert people[0]['name']=='Alex Example'
    assert people[0]['profile_url']=='https://company.test/team/alex'


def test_draft_only_uses_evidenced_overlap():
    result=build_outreach('Alex','Backend Engineer','Acme','I worked on scalable backend APIs',shared_context=None)
    assert 'Alex' in result['body']
    assert 'KAIST' not in result['body']
    assert result['requires_review']


def test_reply_optout_classification():
    assert classify_reply('Please remove me from your list. Do not contact me again.')=='opt_out'
    assert classify_reply('Thanks, happy to refer you!')=='referral'


def test_simplify_csv_roundtrip_and_reject_bad_url():
    items=[{'Company':'Alpha','Job Title':'Backend Engineer','Job URL':'https://alpha.test/jobs/1','Status':'Applied'}]
    content=export_application_csv(items)
    records=read_application_csv(content)
    assert records[0]['company']=='Alpha'
    assert records[0]['status']=='applied'
    invalid=content.replace('https://alpha.test/jobs/1','javascript:alert(1)')
    assert read_application_csv(invalid)==[]

@pytest.mark.asyncio
async def test_people_research_consumes_queue_from_official_page(tmp_path):
    import httpx
    from career.platform import CareerPlatform
    from career.people_worker import run_people_queue
    def serve(req):
        return httpx.Response(200,text='<script type="application/ld+json">{"@type":"Person","name":"Sam Example","jobTitle":"Engineering Manager","url":"https://example.test/team/sam"}</script>')
    with CareerPlatform(tmp_path/'db') as app:
        j=app.record_job(source='test',source_job_id='j',company_name='Example',company_domain='example.test',title='Backend',description='Remote',apply_url='https://example.test/jobs/j',remote_text='remote',published_at=None)
        app.set_eligibility(j,'verified_eligible','Remote from Nigeria allowed','https://example.test/policy')
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            result=await run_people_queue(app,client,limit=1)
        assert result['researched']==1
        assert len(app.contacts(app.get_job(j)['company_id']))==1
        assert app.pending_research()==[]

def test_negative_nigeria_policy_never_marked_verified():
    evidence=[Evidence(source_url='https://example.test/policy',kind='official',scope='job',text='This position is remote. We cannot hire from Nigeria and applicants residing in Nigeria are not eligible.')]
    d=classify_employer_evidence('Remote SWE',evidence)
    assert d.status=='ineligible'
