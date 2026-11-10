import os
from uuid import uuid4
from datetime import datetime,timezone
import pytest
pytestmark=pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='disposable PostgreSQL required')


def test_recruiter_reply_preserves_job_scope_and_is_idempotent(tmp_path):
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    from career.persistence.pg_knowledge import sync_vault
    from career.persistence.pg_outreach import prepare_pg_draft
    from career.persistence.pg_conversation import record_pg_reply
    suffix=uuid4().hex[:10];owner=uuid4()
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as c:
        (tmp_path/'00-profile').mkdir()
        (tmp_path/'00-profile'/(suffix+'.md')).write_text('---\nstatus: approved\nvisibility: outreach-safe\n---\nI build distributed systems.\n')
        sync_vault(c,tmp_path,git_sha=suffix)
        job=c.upsert_job(source='lever',source_job_id=suffix,company_name='Reply Co '+suffix,
            company_domain='reply-'+suffix+'.example',title='Engineer',
            apply_url='https://jobs.example.com/reply/'+suffix,published_at=datetime.now(timezone.utc))
        c.assess_job(job,status='verified_eligible',source_url='https://jobs.example.com/reply/'+suffix,
          excerpt='Remote applicants residing in Nigeria are eligible',confidence=.9)
        cid=c.conn.execute('SELECT company_id FROM ci_jobs WHERE id=%s',(job,)).fetchone()['company_id']
        contact=c.add_contact(cid,{'name':'Alex Manager','title':'Recruiter',
          'profile_url':'https://reply-'+suffix+'.example/team/alex','source':'https://reply-'+suffix+'.example/team'})
        prepare_pg_draft(c,owner,job,contact)
        message='Unfortunately, this particular position requires candidates to reside in the United States.'
        source='https://mail.google.com/mail/u/0/#all/'+suffix
        first=record_pg_reply(c,owner,job_id=job,contact_id=contact,body=message,source_url=source)
        second=record_pg_reply(c,owner,job_id=job,contact_id=contact,body=message,source_url=source)
        assert first['recorded'] is True
        assert second['recorded'] is False
        evidence=c.conn.execute('''SELECT scope,authority,status,job_id FROM ci_employer_intelligence
          WHERE job_id=%s''',(job,)).fetchall()
        assert len(evidence)==1
        assert evidence[0]['scope']=='job' and evidence[0]['status']=='unverified'
        assert evidence[0]['authority']=='user_reported_direct_message'
