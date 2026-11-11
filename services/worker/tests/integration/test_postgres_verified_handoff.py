"""Verified jobs enter durable matching/people workflows without inventing contact data."""
import os
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_verified_role_handoff_is_idempotent_and_requires_identity_for_people():
    import psycopg
    slug=uuid4().hex[:10]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        company=db.execute("""insert into ci_companies(normalized_name,legal_name)
          values(%s,%s) returning id""",('handoff-'+slug,'Handoff '+slug)).fetchone()[0]
        url='https://job-boards.greenhouse.io/'+slug+'/jobs/123'
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
          values(%s,'Backend Engineer',%s,%s,'open',now()) returning id""",
          (company,url,url)).fetchone()[0]
        db.execute("""insert into ci_eligibility_evidence
          (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
          values(%s,%s,'official_ats','Candidates in Nigeria are eligible',%s,
                 'job','Eligible for Nigeria','verified')""",
          (job,url,slug))
        db.execute("""insert into ci_eligibility_assessments
           (job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
           values(%s,'verified_eligible',0.95,'[]'::jsonb,'[]'::jsonb,'test',now()+interval '3 days')""",
          (job,))
        states=db.execute("""select task_type,state from ci_workflow_tasks
          where idempotency_key in (%s,%s) order by task_type""",
          ('ci:matching:'+str(job),'ci:people:'+str(job))).fetchall()
        assert states==[('matching','awaiting_approval'),('people_research','awaiting_approval')]
        assert db.execute("select count(*) from ci_contacts where company_id=%s",(company,)).fetchone()[0]==0
        assert db.execute("select count(*) from ci_contact_research_tasks where company_id=%s",(company,)).fetchone()[0]==0
        assert db.execute("select ci_queue_verified_job_handoffs(%s)",(job,)).fetchone()[0]
        assert db.execute("""select count(*) from ci_workflow_tasks where input_ref=%s""",
          ('job:'+str(job),)).fetchone()[0]==1
        db.execute("""update ci_companies set canonical_domain=%s,identity_confidence='verified'
          where id=%s""",('handoff-'+slug+'.example.com',company))
        assert db.execute("""select state from ci_workflow_tasks where idempotency_key=%s""",
          ('ci:people:'+str(job),)).fetchone()[0]=='pending'
        assert db.execute("""select count(*) from ci_contact_research_tasks
          where company_id=%s and workflow_id is null""",(company,)).fetchone()[0]==1
        db.execute("""insert into ci_eligibility_assessments
           (job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
           values(%s,'ineligible',0.99,'[]'::jsonb,'[]'::jsonb,'changed',now()+interval '7 days')""",
          (job,))
        assert db.execute("""select count(*) from ci_workflow_tasks where
            idempotency_key in (%s,%s) and state='cancelled'""",
          ('ci:matching:'+str(job),'ci:people:'+str(job))).fetchone()[0]==2

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_approved_knowledge_enables_evidence_gated_matching_exactly_once():
    import psycopg
    slug=uuid4().hex[:10]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        doc=db.execute("""insert into ci_knowledge_documents
            (path,git_sha,content_sha,visibility,status)
            values(%s,%s,%s,'matching-safe','approved') returning id""",
            ('skills/'+slug+'.md','revision-'+slug,'hash-'+slug)).fetchone()[0]
        db.execute("""insert into ci_knowledge_versions
            (document_id,revision,body,parsed_metadata)
            values(%s,%s,'Python, distributed systems, infrastructure','{}'::jsonb)""",
            (doc,'hash-'+slug))
        company=db.execute("""insert into ci_companies(normalized_name)
            values(%s) returning id""",('knowledge-'+slug,)).fetchone()[0]
        url='https://jobs.lever.co/'+slug+'/test-job'
        job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status)
            values(%s,'Python Engineer',%s,%s,'open') returning id""",
            (company,url,url)).fetchone()[0]
        db.execute("""insert into ci_eligibility_evidence
          (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
          values(%s,%s,'official_ats','Nigeria supported',%s,'job','verified','verified')""",
          (job,url,slug))
        db.execute("""insert into ci_eligibility_assessments
          (job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
          values(%s,'verified_eligible',0.9,'[]'::jsonb,'[]'::jsonb,'test',now()+interval '3 days')""",
          (job,))
        assert db.execute("""select state from ci_workflow_tasks where
          idempotency_key=%s""",('ci:matching:'+str(job),)).fetchone()[0]=='pending'
        assert db.execute("""select ci_record_verified_match(
          %s,%s,80,'["Python"]'::jsonb,'["Docker"]'::jsonb)""",
          (job,'v'+slug+'1234567890')).fetchone()[0]
        assert db.execute("""select ci_record_verified_match(
          %s,%s,80,'[]'::jsonb,'[]'::jsonb)""",
          (job,'v'+slug+'1234567890')).fetchone()[0] is False
        assert db.execute("""select state from ci_workflow_tasks where
          idempotency_key=%s""",('ci:matching:'+str(job),)).fetchone()[0]=='completed'
        assert db.execute("""select count(*) from ci_job_matches where job_id=%s""",
          (job,)).fetchone()[0]==1

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_handoff_functions_are_private():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert not db.execute("select has_function_privilege(%s,'ci_queue_verified_job_handoffs(uuid)','EXECUTE')",(role,)).fetchone()[0]
            assert not db.execute("select has_function_privilege(%s,'ci_record_verified_match(uuid,text,integer,jsonb,jsonb)','EXECUTE')",(role,)).fetchone()[0]
