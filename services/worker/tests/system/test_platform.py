from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from career.platform import CareerPlatform

NOW=datetime(2026,11,10,tzinfo=timezone.utc)


def test_discovery_to_batch_and_no_repeat(tmp_path):
    with CareerPlatform(tmp_path/'career.db') as app:
        app.add_board('lever','examplecompany','Example Company','example.com')
        assert len(app.boards())==1
        job=app.record_job(source='lever',source_job_id='p1',company_name='Example Company',company_domain='example.com',title='Backend Engineer',description='Remote worldwide. Python and infrastructure.',apply_url='https://jobs.lever.co/examplecompany/p1',remote_text='Remote',published_at=NOW.isoformat(),now=NOW)
        assert app.record_job(source='lever',source_job_id='p1',company_name='Example Company',company_domain='example.com',title='Backend Engineer',description='Remote worldwide. Python and infrastructure.',apply_url='https://jobs.lever.co/examplecompany/p1',remote_text='Remote',published_at=NOW.isoformat(),now=NOW)==job
        assert app.get_job(job)['eligibility'] in ('likely_eligible','verified_eligible','unknown')
        app.set_eligibility(job,'verified_eligible','Official employer confirms hiring from Nigeria','https://example.com/hiring',now=NOW)
        assert len(app.generate_batch('owner','2026-11-10'))==1
        assert app.generate_batch('owner','2026-11-10')==app.daily_batch('owner','2026-11-10')
        assert app.generate_batch('owner','2026-11-11')==[]
        app.record_application('owner',job,'applied',now=NOW)
        assert app.applications('owner')[0]['status']=='applied'
    with CareerPlatform(tmp_path/'career.db') as app:
        assert len(app.daily_batch('owner','2026-11-10'))==1
        assert app.generate_batch('owner','2026-11-12')==[]


def test_contact_evidence_and_no_unapproved_send(tmp_path):
    with CareerPlatform(tmp_path/'db') as app:
        jid=app.record_job(source='test',source_job_id='a',company_name='C',company_domain='c.test',title='Engineer',description='Remote',apply_url='https://c.test/jobs/a',remote_text='remote',published_at=NOW.isoformat(),now=NOW)
        cid=app.add_contact(company_id=app.get_job(jid)['company_id'],name='Example Engineer',title='Engineering Manager',profile_url='https://c.test/team/manager',email='person@c.test',email_verified=True)
        assert app.add_contact(company_id=app.get_job(jid)['company_id'],name='Example Engineer',title='Engineering Manager',profile_url='https://c.test/team/manager',email='person@c.test',email_verified=True)==cid
        draft=app.draft_email('owner',jid,cid,'Hello','I recently applied for this job.')
        assert app.authorize_message(draft,'auto') is False
        assert app.authorize_message(draft,'manual') is False
        app.record_application('owner',jid,'applied',now=NOW)
        assert app.authorize_message(draft,'manual') is True
        assert app.dispatch_status(draft)=='approved'
        assert app.authorize_message(draft,'manual') is True
        assert app.dispatch_status(draft)=='approved'


def test_no_auto_send_by_default_even_after_application(tmp_path):
    with CareerPlatform(tmp_path/'db') as app:
        j=app.record_job(source='test',source_job_id='j',company_name='One',company_domain='one.com',title='SWE',description='Remote',apply_url='https://one.com/jobs/j',remote_text='remote',published_at=NOW.isoformat(),now=NOW)
        app.record_application('owner',j,'applied',now=NOW)
        c=app.add_contact(app.get_job(j)['company_id'],'One Recruiter','Recruiter','https://one.com/recruiter','recruiter@one.com',True)
        d=app.draft_email('owner',j,c,'Hi','Hello there')
        assert app.authorize_message(d,'auto') is False
        app.configure_auto_send('owner', enabled=True, daily_limit=10, max_per_company=1)
        assert app.authorize_message(d,'auto') is True
        assert app.dispatch_status(d)=='approved'


def test_knowledge_revision_and_private_exclusion(tmp_path):
    vault=tmp_path/'vault'; (vault/'00-profile').mkdir(parents=True); (vault/'07-private').mkdir()
    (vault/'00-profile'/'skills.md').write_text('---\nstatus: approved\nvisibility: matching-safe\n---\nPython infrastructure')
    (vault/'07-private'/'secret.md').write_text('---\nstatus: approved\nvisibility: agents-safe\n---\nSECRET')
    with CareerPlatform(tmp_path/'db') as app:
        assert app.ingest_vault(vault)==1
        assert 'Python infrastructure' in app.knowledge_for('matching')
        assert 'SECRET' not in app.knowledge_for('matching')
        (vault/'00-profile'/'skills.md').unlink()
        assert app.ingest_vault(vault)==0
        assert 'Python infrastructure' not in app.knowledge_for('matching')

def test_company_without_domain_reuses_identity_within_same_source(tmp_path):
    with CareerPlatform(tmp_path/'db') as app:
        ids=[]
        for n in ('a','b'):
            jid=app.record_job(source='remotive',source_job_id=n,company_name='Remote Labs',company_domain=None,title='SWE',description='Remote anywhere',apply_url='https://remotive.com/jobs/'+n,remote_text='remote',published_at=None,now=NOW)
            ids.append(app.get_job(jid)['company_id'])
        assert ids[0]==ids[1]
        assert app.dashboard_metrics('x')['companies']==1


def test_verified_eligibility_queues_contact_research_once(tmp_path):
    with CareerPlatform(tmp_path/'db') as app:
        jid=app.record_job(source='test',source_job_id='a',company_name='A',company_domain='a.com',title='Engineer',description='Remote',apply_url='https://a.com/jobs/a',remote_text='remote',published_at=NOW.isoformat(),now=NOW)
        app.set_eligibility(jid,'verified_eligible','Remote Nigeria allowed','https://a.com/policy')
        app.set_eligibility(jid,'verified_eligible','Remote Nigeria allowed','https://a.com/policy')
        assert len(app.pending_research())==1
        assert app.pending_research()[0]['kind']=='people'

def test_missing_vault_cannot_erase_approved_knowledge(tmp_path):
    vault=tmp_path/'vault'; (vault/'00-profile').mkdir(parents=True)
    (vault/'00-profile'/'profile.md').write_text('---\nstatus: approved\nvisibility: agents-safe\n---\nApproved content')
    with CareerPlatform(tmp_path/'db') as app:
        app.ingest_vault(vault)
        try:app.ingest_vault(tmp_path/'missing')
        except ValueError:pass
        else:raise AssertionError('missing vault allowed')
        assert 'Approved content' in app.knowledge_for('discovery')


def test_rejected_application_cannot_trigger_auto_outreach(tmp_path):
    with CareerPlatform(tmp_path/'db') as app:
        jid=app.record_job(source='test',source_job_id='a',company_name='A',company_domain='a.com',title='SWE',description='Remote',apply_url='https://a.com/jobs/a',remote_text='remote',published_at=NOW.isoformat(),now=NOW)
        app.record_application('o',jid,'rejected')
        contact=app.add_contact(app.get_job(jid)['company_id'],'Jane Recruiter','Recruiter','https://a.com/jane','jane@a.com',True)
        draft=app.draft_email('o',jid,contact,'Hello','Hi')
        app.configure_auto_send('o',enabled=True)
        assert not app.authorize_message(draft,'auto')


def test_daily_batch_top_up_after_new_eligible_company_without_repeating_previous(tmp_path):
    with CareerPlatform(tmp_path/'batch.db') as app:
        a = app.record_job(source='test', source_job_id='a', company_name='Alpha',
            company_domain='alpha.example', title='Backend Engineer', description='Remote Nigeria',
            apply_url='https://alpha.example/jobs/a', remote_text='Remote Nigeria',
            published_at=NOW.isoformat(), now=NOW)
        app.set_eligibility(a, 'verified_eligible', 'Official policy', 'https://alpha.example/policy')
        first = app.generate_batch('owner', '2026-11-10', target=2)
        assert [j['id'] for j in first] == [a]
        b = app.record_job(source='test', source_job_id='b', company_name='Beta',
            company_domain='beta.example', title='Platform Engineer', description='Remote Nigeria',
            apply_url='https://beta.example/jobs/b', remote_text='Remote Nigeria',
            published_at=NOW.isoformat(), now=NOW)
        app.set_eligibility(b, 'verified_eligible', 'Official policy', 'https://beta.example/policy')
        second = app.generate_batch('owner', '2026-11-10', target=2)
        assert [j['id'] for j in second] == [a, b]
        assert app.generate_batch('owner', '2026-11-10', target=2) == second
        assert app.generate_batch('owner', '2026-11-11', target=2) == []
