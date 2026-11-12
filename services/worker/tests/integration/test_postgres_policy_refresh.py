"""A policy upgrade requeues weak official decisions exactly once, never invents eligibility."""
import os
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated Postgres needed')
def test_policy_refresh_is_bounded_idempotent_and_preserves_verification():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        ids={}
        for status in ('unknown','likely_eligible','verified_eligible','ineligible'):
            marker=uuid4().hex[:12]
            company=db.execute(
                "insert into ci_companies(normalized_name) values(%s) returning id",
                ('policy-'+marker,)).fetchone()[0]
            url=f'https://jobs.lever.co/{marker}/123'
            job=db.execute(
                """insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
                   values(%s,'Backend Engineer',%s,%s,'open',now()) returning id""",
                (company,url,url)).fetchone()[0]
            db.execute(
                "insert into ci_job_sources(job_id,source_name,source_job_id,source_url) values(%s,'lever',%s,%s)",
                (job,marker+':123',url))
            db.execute(
                "insert into ci_eligibility_review_queue(job_id,state) values(%s,'reviewed')",(job,))
            db.execute(
                """insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version,assessed_at,expires_at)
                   values(%s,%s,0.5,'[]'::jsonb,'[]'::jsonb,'older',now()-interval '1 day',now()+interval '1 day')""",
                (job,status))
            ids[status]=job
        assert db.execute("select ci_requeue_policy_reviews(1)").fetchone()[0]==1
        assert db.execute("select ci_requeue_policy_reviews(30)").fetchone()[0]>=1
        assert db.execute("select ci_requeue_policy_reviews(30)").fetchone()[0]==0
        for status,job in ids.items():
            state=db.execute("select state from ci_eligibility_review_queue where job_id=%s",(job,)).fetchone()[0]
            assert state==('pending' if status in ('unknown','likely_eligible') else 'reviewed')
            latest=db.execute(
                "select status from ci_eligibility_assessments where job_id=%s order by assessed_at desc,id desc limit 1",
                (job,)).fetchone()[0]
            assert latest==status
        for role in ('anon','authenticated'):
            assert not db.execute(
                "select has_function_privilege(%s,'ci_requeue_policy_reviews(integer)','EXECUTE')",
                (role,)).fetchone()[0]
