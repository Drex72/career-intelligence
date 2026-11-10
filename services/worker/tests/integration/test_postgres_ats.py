"""Public ATS scans are private, durable, idempotent, and never grant Nigeria eligibility."""
import os
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'), reason='isolated PostgreSQL required')
def test_ats_board_claim_and_unverified_posting():
    import psycopg
    slug='ci'+uuid4().hex[:10]
    provider='greenhouse'
    name='Test '+slug
    url=f'https://job-boards.greenhouse.io/{slug}/jobs/12345'
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        sid=db.execute(
          """insert into ci_discovery_sources(name,kind,state,config)
             values(%s,'ats','active',%s::jsonb) returning id""",
          ('ats:'+provider+':'+slug,'{"provider":"greenhouse"}')).fetchone()[0]
        assert db.execute("select ci_claim_ats_slot(%s)",(sid,)).fetchone()[0] is True
        assert db.execute("select ci_claim_ats_slot(%s)",(sid,)).fetchone()[0] is False
        p=(provider,slug,'12345',name,'Software Engineer',url,None,'Remote')
        job=db.execute("select ci_ingest_ats_job(%s,%s,%s,%s,%s,%s,%s,%s)",p).fetchone()[0]
        assert job
        assert db.execute("select ci_ingest_ats_job(%s,%s,%s,%s,%s,%s,%s,%s)",p).fetchone()[0]==job
        assert db.execute("select status from ci_jobs where id=%s",(job,)).fetchone()[0]=='open'
        assert db.execute("select count(*) from ci_eligibility_assessments where job_id=%s",(job,)).fetchone()[0]==0
        assert db.execute("select count(*) from ci_eligibility_review_queue where job_id=%s",(job,)).fetchone()[0]==1
        assert db.execute("select count(*) from ci_job_sources where job_id=%s",(job,)).fetchone()[0]==1
        wrong=list(p); wrong[5]='https://malicious.example/'+slug+'/jobs/12345'
        assert db.execute("select ci_ingest_ats_job(%s,%s,%s,%s,%s,%s,%s,%s)",wrong).fetchone()[0] is None
        assert db.execute("select count(*) from ci_job_sources where job_id=%s",(job,)).fetchone()[0]==1

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'), reason='isolated PostgreSQL required')
def test_ats_database_actions_are_not_available_to_browser_roles():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert db.execute("select has_function_privilege(%s,'ci_claim_ats_slot(uuid)','EXECUTE')",(role,)).fetchone()[0] is False
            assert db.execute("select has_function_privilege(%s,'ci_ingest_ats_job(text,text,text,text,text,text,timestamptz,text)','EXECUTE')",(role,)).fetchone()[0] is False
            assert db.execute("select has_table_privilege(%s,'ci_eligibility_review_queue','SELECT')",(role,)).fetchone()[0] is False
