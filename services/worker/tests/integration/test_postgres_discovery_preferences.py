"""Owner settings are enforced at the database recommendation boundary, not just UI."""
import os
from datetime import date,datetime,timezone
from uuid import uuid4
import pytest

pytestmark=pytest.mark.skipif(not os.getenv("PG_TEST_DSN"),reason="isolated PostgreSQL required")

def test_preference_target_and_unknown_sponsorship_are_conservative():
    import psycopg
    owner=uuid4();stamp=str(uuid4())[:10]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        db.execute("insert into auth.users(id) values(%s) on conflict do nothing",(owner,))
        db.execute("insert into ci_workspace_owners(owner_user_id) values(%s) on conflict do nothing",(owner,))
        assert db.execute("""select ci_save_discovery_preferences(%s,2,
          array['backend'],array['senior'],array['remote'],'confirmed_required')""",(owner,)).fetchone()[0] is True
        assert db.execute("""select ci_save_discovery_preferences(%s,101,
          array['any'],array['any'],array['any'],'any')""",(owner,)).fetchone()[0] is False
        assert db.execute("""select ci_save_discovery_preferences(%s,2,
          array['any','backend'],array['any'],array['any'],'any')""",(owner,)).fetchone()[0] is False
        cid=db.execute("insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
           ('prefs-'+stamp,'Preferences '+stamp)).fetchone()[0]
        url='https://example.org/job/'+stamp
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
          values(%s,'Senior Backend Engineer',%s,%s,'open',now()) returning id""",(cid,url,url)).fetchone()[0]
        db.execute("""insert into ci_eligibility_assessments
          (job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
          values(%s,'verified_eligible',0.95,'[]'::jsonb,'[]'::jsonb,'test',now()+interval '1 day')""",(job,))
        evidence=db.execute("""insert into ci_eligibility_evidence
          (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
          values(%s,%s,'official_job','Nigerian residents eligible',%s,'job','Nigeria eligible','verified')
          returning id""",(job,url,stamp)).fetchone()[0]
        assert db.execute("select ci_job_matches_preferences(%s,%s)",(job,owner)).fetchone()[0] is False
        assert db.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,date.today())).fetchone()[0]==0
        db.execute("""insert into ci_job_work_facts(job_id,work_mode,sponsorship,source_evidence_id)
          values(%s,'remote','unknown',%s)""",(job,evidence))
        assert db.execute("select ci_job_matches_preferences(%s,%s)",(job,owner)).fetchone()[0] is False
        db.execute("update ci_job_work_facts set sponsorship='confirmed' where job_id=%s",(job,))
        assert db.execute("select ci_job_matches_preferences(%s,%s)",(job,owner)).fetchone()[0] is True
        assert db.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,date.today())).fetchone()[0]==1
        assert db.execute("select target from ci_daily_batches where owner_user_id=%s",(owner,)).fetchone()[0]==2
        assert db.execute("select ci_generate_daily_batch(%s,%s,100)",(owner,date.today())).fetchone()[0]==0

def test_job_family_and_level_filters_require_explicit_title_evidence():
    import psycopg
    owner=uuid4();suffix=uuid4().hex[:12]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        db.execute("insert into auth.users(id) values(%s) on conflict do nothing",(owner,))
        db.execute("insert into ci_workspace_owners(owner_user_id) values(%s) on conflict do nothing",(owner,))
        assert db.execute("""select ci_save_discovery_preferences(%s,5,
          array['ai_ml'],array['intern'],array['any'],'any')""",(owner,)).fetchone()[0]
        company=db.execute("insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
          ('prefs-'+suffix,'Company '+suffix)).fetchone()[0]
        rows=[]
        for i,title in enumerate(['Backend Engineer','Machine Learning Intern','Senior Machine Learning Engineer','Senior Sales Engineer']):
            url=f'https://example.org/prefs/{suffix}/{i}'
            rows.append(db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status)
              values(%s,%s,%s,%s,'open') returning id""",(company,title,url,url)).fetchone()[0])
        assert [db.execute("select ci_job_matches_preferences(%s,%s)",(r,owner)).fetchone()[0] for r in rows]==[False,True,False,False]

def test_preferences_and_evidence_tables_are_server_only():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert db.execute("select has_function_privilege(%s,'ci_save_discovery_preferences(uuid,integer,text[],text[],text[],text)','EXECUTE')",(role,)).fetchone()[0] is False
            assert db.execute("select has_table_privilege(%s,'ci_discovery_preferences','SELECT')",(role,)).fetchone()[0] is False
            assert db.execute("select has_table_privilege(%s,'ci_job_work_facts','SELECT')",(role,)).fetchone()[0] is False
