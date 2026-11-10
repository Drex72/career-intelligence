"""CI daily deliveries are owner-scoped, evidence-gated, and strictly lifetime deduplicated."""
import os
from datetime import datetime, timezone, timedelta, date
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL required')
def test_daily_batch_only_delivers_verified_evidence_once():
    import psycopg
    owner=uuid4()
    today=date.today()
    label=str(uuid4())[:8]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as conn:
        cid=conn.execute(
            "insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
            ('batch-'+label,'Batch '+label)).fetchone()[0]
        open_id=conn.execute(
            """insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
               values(%s,'Backend Engineer',%s,%s,'open',%s) returning id""",
            (cid,'https://example.org/jobs/'+label,'https://example.org/jobs/'+label,datetime.now(timezone.utc))).fetchone()[0]
        conn.execute(
            """insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version)
               values(%s,'verified_eligible',0.95,'[]'::jsonb,'[]'::jsonb,'human-reviewed-v1')""",(open_id,))
        conn.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,today))
        assert conn.execute("select count(*) from ci_delivered_companies where owner_user_id=%s and company_id=%s",(owner,cid)).fetchone()[0]==0
        conn.execute(
            """insert into ci_eligibility_evidence(job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
               values(%s,%s,'official_job','Applicants residing in Nigeria are eligible',%s,'job','Nigeria eligible','verified')""",
            (open_id,'https://example.org/jobs/'+label,str(uuid4())))
        assert conn.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,today)).fetchone()[0]==1
        assert conn.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,today)).fetchone()[0]==0
        assert conn.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,today+timedelta(days=1))).fetchone()[0]==0
        assert conn.execute("select count(*) from ci_delivered_companies where owner_user_id=%s and company_id=%s",(owner,cid)).fetchone()[0]==1
        assert conn.execute("select count(*) from ci_daily_batch_items i join ci_daily_batches b on b.id=i.batch_id where b.owner_user_id=%s and i.job_id=%s",(owner,open_id)).fetchone()[0]==1

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL required')
def test_batch_function_is_not_callable_by_browser_roles():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as conn:
        result=conn.execute(
          "select has_function_privilege('anon','ci_generate_daily_batch(uuid,date,integer)','EXECUTE'),has_function_privilege('authenticated','ci_generate_daily_batch(uuid,date,integer)','EXECUTE')").fetchone()
        assert result==(False,False)
