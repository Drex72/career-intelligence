from datetime import datetime, timezone
from career.platform import CareerPlatform


def test_auto_quota_is_bound_to_approval_day_not_draft_day(tmp_path):
    with CareerPlatform(tmp_path/'db') as p:
        j=p.record_job(source='sample',source_job_id='1',company_name='Example',company_domain='example.com',title='Engineer',description='Worldwide remote',apply_url='https://example.com/one',remote_text='remote',published_at=datetime(2026,1,1,tzinfo=timezone.utc).isoformat())
        p.record_application('owner',j,'applied')
        p.configure_auto_send('owner',enabled=True,daily_limit=1,max_per_company=2)
        c=p.add_contact(p.get_job(j)['company_id'],'Alex','Recruiter','https://example.com/alex','alex@example.com',True)
        d1=p.draft_email('owner',j,c,'Hi Alex','Hello')
        # Draft creation can be months before authorization.
        p.db.execute("UPDATE outreach SET created_at='2026-01-01T00:00:00+00:00' WHERE id=?",(d1,))
        assert p.authorize_message(d1,'auto')
        d2=p.draft_email('owner',j,c,'Second','Message')
        assert not p.authorize_message(d2,'auto')


def test_revoked_auto_policy_prevents_dispatch_of_previously_approved_message(tmp_path):
    from career.mailer import GmailDispatcher
    sent=[]
    with CareerPlatform(tmp_path/'db') as p:
        job=p.record_job(source='test',source_job_id='r',company_name='RecruiterCo',company_domain='recruiter.example',title='SWE',description='Remote',apply_url='https://recruiter.example/role',remote_text='remote',published_at=None)
        p.record_application('owner',job,'applied')
        person=p.add_contact(p.get_job(job)['company_id'],'Recruiter','Recruiter','https://recruiter.example/team','recruiter@recruiter.example',True)
        draft=p.draft_email('owner',job,person,'Role','Thanks for considering my application')
        p.configure_auto_send('owner',enabled=True)
        assert p.authorize_message(draft,'auto')
        p.configure_auto_send('owner',enabled=False)
        dispatcher=GmailDispatcher(p,lambda *args:sent.append(args) or 'id')
        assert not dispatcher.send(draft)
        assert sent==[]
        p.configure_auto_send('owner',enabled=True)
        assert not dispatcher.send(draft), 'revocation must invalidate old auto-approval'
        assert sent==[]


def test_rejected_application_prevents_dispatch_after_manual_approval(tmp_path):
    from career.mailer import GmailDispatcher
    sent=[]
    with CareerPlatform(tmp_path/'db') as p:
        job=p.record_job(source='test',source_job_id='r',company_name='RecruiterCo',company_domain='recruiter.example',title='SWE',description='Remote',apply_url='https://recruiter.example/role',remote_text='remote',published_at=None)
        p.record_application('owner',job,'applied')
        person=p.add_contact(p.get_job(job)['company_id'],'Recruiter','Recruiter','https://recruiter.example/team','recruiter@recruiter.example',True)
        draft=p.draft_email('owner',job,person,'Role','Thanks for considering my application')
        assert p.authorize_message(draft,'manual')
        p.record_application('owner',job,'rejected')
        dispatcher=GmailDispatcher(p,lambda *args:sent.append(args) or 'id')
        assert not dispatcher.send(draft)
        assert sent==[]
