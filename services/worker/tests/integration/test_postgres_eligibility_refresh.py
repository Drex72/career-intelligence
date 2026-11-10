"""Expiration never preserves an outdated positive hiring decision."""
import os
from uuid import uuid4
from datetime import datetime, timezone, timedelta
import pytest

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated Postgres needed')
def test_expired_review_requeues_and_updated_negative_overrides_verified():
    import psycopg
    label=uuid4().hex[:10]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        company=db.execute('insert into ci_companies(normalized_name) values(%s) returning id',('recheck-'+label,)).fetchone()[0]
        url=f'https://job-boards.greenhouse.io/{label}/jobs/555'
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
            values(%s,'Backend Engineer',%s,%s,'open',now()) returning id""",(company,url,url)).fetchone()[0]
        db.execute("""insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
           values(%s,'greenhouse',%s,%s)""",(job,label+':555',url))
        db.execute("insert into ci_eligibility_review_queue(job_id,state) values(%s,'reviewed')",(job,))
        db.execute("""insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
          values(%s,'verified_eligible',0.9,'[]'::jsonb,'[]'::jsonb,'v1',now()-interval '1 day')""",(job,))
        assert db.execute("select ci_requeue_expired_reviews(100)").fetchone()[0]>=1
        assert db.execute("select state from ci_eligibility_review_queue where job_id=%s",(job,)).fetchone()[0]=='pending'
        assert db.execute("""select ci_record_ats_review(%s,%s,'ineligible',0.98,
            'Candidates in Nigeria are not eligible','Official posting excludes Nigeria')""",(job,url)).fetchone()[0] is True
        assert db.execute("select state from ci_eligibility_review_queue where job_id=%s",(job,)).fetchone()[0]=='reviewed'
        latest=db.execute("""select status from ci_eligibility_assessments where job_id=%s
         order by assessed_at desc,id desc limit 1""",(job,)).fetchone()[0]
        assert latest=='ineligible'
        assert db.execute("select ci_requeue_expired_reviews(100)").fetchone()[0]==0

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated Postgres needed')
def test_current_positive_can_be_revoked_when_official_source_changes():
    import psycopg
    label=uuid4().hex[:10]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        company=db.execute('insert into ci_companies(normalized_name) values(%s) returning id',('revocation-'+label,)).fetchone()[0]
        url=f'https://jobs.lever.co/{label}/abc123'
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
          values(%s,'Software Engineer',%s,%s,'open',now()) returning id""",(company,url,url)).fetchone()[0]
        db.execute("insert into ci_job_sources(job_id,source_name,source_job_id,source_url) values(%s,'lever',%s,%s)",(job,label+':abc123',url))
        db.execute("insert into ci_eligibility_review_queue(job_id,state) values(%s,'pending')",(job,))
        db.execute("""insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
          values(%s,'verified_eligible',0.9,'[]'::jsonb,'[]'::jsonb,'prior',now()+interval '6 days')""",(job,))
        assert db.execute("""select ci_record_ats_review(%s,%s,'ineligible',0.99,
          'Cannot employ applicants in Nigeria','Updated official listing excludes Nigeria')""",(job,url)).fetchone()[0]
        assert db.execute("""select status from ci_eligibility_assessments where job_id=%s
          order by assessed_at desc,id desc limit 1""",(job,)).fetchone()[0]=='ineligible'

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated Postgres needed')
def test_requeue_and_decision_privileges_are_server_only():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert db.execute("select has_function_privilege(%s,'ci_requeue_expired_reviews(integer)','EXECUTE')",(role,)).fetchone()[0] is False
            assert db.execute("select has_function_privilege(%s,'ci_record_ats_review(uuid,text,text,numeric,text,text)','EXECUTE')",(role,)).fetchone()[0] is False
