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
