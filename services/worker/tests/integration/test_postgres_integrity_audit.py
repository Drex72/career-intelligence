"""Production audit is evidence-based, owner-scoped and read-only."""
import os
from uuid import uuid4
import pytest

pytestmark=pytest.mark.skipif(not os.environ.get("PG_TEST_DSN"),reason="disposable PostgreSQL required")

def test_report_returns_truthful_empty_metrics_without_writing():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"],autocommit=True) as db:
        owner=uuid4()
        db.execute("insert into auth.users(id) values(%s)",(owner,))
        db.execute("insert into ci_workspace_owners(owner_user_id) values(%s)",(owner,))
        before=db.execute("select count(*) from ci_daily_batches where owner_user_id=%s",(owner,)).fetchone()[0]
        report=db.execute("select ci_pipeline_integrity_report(%s)",(owner,)).fetchone()[0]
        assert report['integrity_ok'] is True
        assert report['generation_ready'] is False
        assert report['eligible_undelivered_jobs_now']==0
        assert report['daily_target']==25
        assert report['integrity_violations']==0
        assert db.execute("select count(*) from ci_daily_batches where owner_user_id=%s",(owner,)).fetchone()[0]==before
        assert db.execute("select ci_pipeline_integrity_report(%s)",(uuid4(),)).fetchone()[0] is None

def test_approved_evidence_eligible_job_updates_readiness_and_preference_target():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"],autocommit=True) as db:
        owner=uuid4();suffix=uuid4().hex[:12]
        db.execute("insert into auth.users(id) values(%s)",(owner,))
        db.execute("insert into ci_workspace_owners(owner_user_id) values(%s)",(owner,))
        assert db.execute("""select ci_save_discovery_preferences(%s,3,array['backend'],
          array['senior'],array['any'],'any')""",(owner,)).fetchone()[0]
        company=db.execute("insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",('audit-'+suffix,'Audit '+suffix)).fetchone()[0]
        url="https://jobs.example.org/backend/"+suffix
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
            values(%s,'Senior Backend Engineer',%s,%s,'open',now()) returning id""",(company,url,url)).fetchone()[0]
        db.execute("insert into ci_job_sources(job_id,source_name,source_job_id,source_url) values(%s,'manual',%s,%s)",(job,suffix,url))
        db.execute("""insert into ci_eligibility_evidence
          (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
          values(%s,%s,'official_job','Nigeria residents eligible',%s,'job','Nigeria eligible','verified')""",(job,url,suffix))
        db.execute("""insert into ci_eligibility_assessments
          (job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
          values(%s,'verified_eligible',0.99,'[]'::jsonb,'[]'::jsonb,'test',now()+interval '1 day')""",(job,))
        report=db.execute("select ci_pipeline_integrity_report(%s)",(owner,)).fetchone()[0]
        assert report['integrity_ok'] is True
        assert report['generation_ready'] is True
        assert report['daily_target']==3
        assert report['eligible_undelivered_jobs_now']>=1

def test_browser_roles_cannot_execute_pipeline_audit():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"]) as db:
        for role in ('anon','authenticated'):
            assert db.execute("select has_function_privilege(%s,'ci_pipeline_integrity_report(uuid)','EXECUTE')",(role,)).fetchone()[0] is False
        assert db.execute("select has_function_privilege('service_role','ci_pipeline_integrity_report(uuid)','EXECUTE')").fetchone()[0] is True
