"""US-employer worldwide-remote targeting is evidence gated, not US-residence targeting."""
import os
from uuid import uuid4
from datetime import date
import pytest

@pytest.mark.skipif(not os.getenv("PG_TEST_DSN"), reason="isolated PostgreSQL required")
def test_owner_us_worldwide_filter_rejects_unproven_employer_and_remote_scope():
    import psycopg
    slug=uuid4().hex[:12]
    owner=uuid4()
    with psycopg.connect(os.environ["PG_TEST_DSN"],autocommit=True) as db:
        db.execute("""insert into ci_discovery_preferences(owner_user_id,daily_target)
          values(%s,100)""",(owner,))
        db.execute("""insert into ci_geo_target_preferences
          (owner_user_id,employer_country,applicant_country,remote_scope)
          values(%s,'US','NG','worldwide')""",(owner,))
        company=db.execute("""insert into ci_companies(normalized_name,legal_name)
          values(%s,%s) returning id""",('usglob-'+slug,'US Global '+slug)).fetchone()[0]
        url='https://job-boards.greenhouse.io/'+slug+'/jobs/123'
        job=db.execute("""insert into ci_jobs
          (company_id,title,apply_url,canonical_apply_url,status,published_at)
          values(%s,'Backend Engineer',%s,%s,'open',now()) returning id""",
          (company,url,url)).fetchone()[0]
        db.execute("""insert into ci_eligibility_evidence
          (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
          values(%s,%s,'official_ats','Nigeria applicants explicitly eligible',%s,'job','Nigeria eligible','verified')""",
          (job,url,slug))
        db.execute("""insert into ci_eligibility_assessments
          (job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
          values(%s,'verified_eligible',0.98,'[]'::jsonb,'[]'::jsonb,'test',now()+interval '3 days')""",(job,))
        assert db.execute("select ci_job_matches_geo_target(%s,%s)",(job,owner)).fetchone()[0] is False
        db.execute("""insert into ci_company_country_evidence(company_id,country,source_url)
          values(%s,'US','https://example.org/official-about')""",(company,))
        assert db.execute("select ci_job_matches_geo_target(%s,%s)",(job,owner)).fetchone()[0] is False
        db.execute("""insert into ci_job_remote_scope_evidence
          (job_id,scope,source_url,expires_at)
          values(%s,'worldwide',%s,now()+interval '2 days')""",(job,url))
        assert db.execute("select ci_job_matches_geo_target(%s,%s)",(job,owner)).fetchone()[0] is True
        assert db.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,date.today())).fetchone()[0]>=1
        assert db.execute("""select count(*) from ci_delivered_jobs where
          owner_user_id=%s and job_id=%s""",(owner,job)).fetchone()[0]==1

@pytest.mark.skipif(not os.getenv("PG_TEST_DSN"), reason="isolated PostgreSQL required")
def test_owner_geo_filter_rejects_usa_only_and_expired_scope():
    import psycopg
    slug=uuid4().hex[:10]
    owner=uuid4()
    with psycopg.connect(os.environ["PG_TEST_DSN"],autocommit=True) as db:
        db.execute("insert into ci_discovery_preferences(owner_user_id) values(%s)",(owner,))
        db.execute("""insert into ci_geo_target_preferences(owner_user_id,employer_country,applicant_country,remote_scope)
          values(%s,'US','NG','worldwide')""",(owner,))
        company=db.execute("""insert into ci_companies(normalized_name,legal_name)
          values(%s,%s) returning id""",('usrestricted-'+slug,'Restricted '+slug)).fetchone()[0]
        url='https://jobs.lever.co/'+slug+'/123'
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status)
          values(%s,'Software Engineer',%s,%s,'open') returning id""",(company,url,url)).fetchone()[0]
        db.execute("insert into ci_company_country_evidence(company_id,country,source_url) values(%s,'US','https://example.org/about')",(company,))
        db.execute("""insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version)
          values(%s,'verified_eligible',0.9,'[]','[]','test')""",(job,))
        db.execute("""insert into ci_job_remote_scope_evidence(job_id,scope,source_url,expires_at)
          values(%s,'restricted',%s,now()+interval '2 days')""",(job,url))
        assert not db.execute("select ci_job_matches_geo_target(%s,%s)",(job,owner)).fetchone()[0]
        db.execute("""update ci_job_remote_scope_evidence set scope='worldwide',
          expires_at=now()-interval '1 minute' where job_id=%s""",(job,))
        assert not db.execute("select ci_job_matches_geo_target(%s,%s)",(job,owner)).fetchone()[0]

@pytest.mark.skipif(not os.getenv("PG_TEST_DSN"), reason="isolated PostgreSQL required")
def test_geo_target_evidence_is_private():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"]) as db:
        for role in ('anon','authenticated'):
            for table in ('ci_geo_target_preferences','ci_company_country_evidence',
                          'ci_job_remote_scope_evidence'):
                assert db.execute("select has_table_privilege(%s,%s,'SELECT')",(role,table)).fetchone()[0] is False
            for signature in ("ci_job_matches_geo_target(uuid,uuid)",
                              "ci_record_ats_remote_scope(uuid,text,text)"):
                assert db.execute("select has_function_privilege(%s,%s,'EXECUTE')",
                                  (role,signature)).fetchone()[0] is False
