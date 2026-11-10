"""Service-only job-scoped ATS eligibility decisions are auditable and rate-limited."""
import os
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_official_review_audits_source_and_claims_once():
    import psycopg
    label=uuid4().hex[:10]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        company=db.execute(
          "insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
          ('verified-'+label,'Verified '+label)).fetchone()[0]
        url=f'https://job-boards.greenhouse.io/{label}/jobs/108'
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status)
          values(%s,'Backend Engineer',%s,%s,'open') returning id""",(company,url,url)).fetchone()[0]
        db.execute("""insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
          values(%s,'greenhouse',%s,%s)""",(job,label+':108',url))
        db.execute("insert into ci_eligibility_review_queue(job_id) values(%s)",(job,))
        assert db.execute("select ci_claim_job_review_slot(%s)",(job,)).fetchone()[0] is True
        assert db.execute("select ci_claim_job_review_slot(%s)",(job,)).fetchone()[0] is False
        assert db.execute("""select ci_record_ats_review(%s,%s,'verified_eligible',0.9,
            'Candidates based in Nigeria are eligible.','Explicit job-scoped Nigeria eligibility')""",(job,url)).fetchone()[0] is True
        assert db.execute("select state from ci_eligibility_review_queue where job_id=%s",(job,)).fetchone()[0]=='reviewed'
        assert db.execute("select count(*) from ci_eligibility_evidence where job_id=%s",(job,)).fetchone()[0]==1
        assert db.execute("""select status from ci_eligibility_assessments where job_id=%s
          order by assessed_at desc limit 1""",(job,)).fetchone()[0]=='verified_eligible'
        assert db.execute("""select ci_record_ats_review(%s,%s,'unknown',0,
          '','Posting did not establish Nigeria hiring')""",(job,url)).fetchone()[0] is False
        assert db.execute("""select ci_record_ats_review(%s,%s,'ineligible',0.9,
          'Nigeria excluded.','Nigeria hiring explicitly excluded')""",
          (job,'https://example.invalid/role')).fetchone()[0] is False

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_official_eligibility_review_is_server_only():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert db.execute("select has_function_privilege(%s,'ci_claim_job_review_slot(uuid)','EXECUTE')",(role,)).fetchone()[0] is False
            assert db.execute("select has_function_privilege(%s,'ci_record_ats_review(uuid,text,text,numeric,text,text)','EXECUTE')",(role,)).fetchone()[0] is False
