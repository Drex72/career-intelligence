"""Only a verified applied job and approved verified recipient can produce a queued intent.

This suite runs against disposable PostgreSQL in CI. NO provider sends occur.
"""
from datetime import datetime, timezone
from uuid import uuid4
import os
import pytest
pytestmark=pytest.mark.skipif(not os.environ.get("PG_TEST_DSN"),reason="disposable PostgreSQL required")


def setup_draft(db, *, owner=None, applied=True, verified_email=True, verified_eligibility=True):
    owner = owner or uuid4()
    suffix=uuid4().hex[:12]
    db.execute("insert into auth.users(id) values(%s) on conflict do nothing",(owner,))
    db.execute("insert into ci_workspace_owners(owner_user_id) values(%s) on conflict do nothing",(owner,))
    company=db.execute(
        "insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
        ("intent-"+suffix,"Intent Test "+suffix)).fetchone()[0]
    url="https://jobs.example.org/intent/"+suffix
    job=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
        values(%s,'Backend Engineer',%s,%s,'open',now()) returning id""",
        (company,url,url)).fetchone()[0]
    if verified_eligibility:
        db.execute("""insert into ci_eligibility_assessments
          (job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
          values(%s,'verified_eligible',0.95,'[]'::jsonb,'[]'::jsonb,'test-v1',now()+interval '1 day')""",(job,))
    db.execute("""insert into ci_eligibility_evidence
      (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
      values(%s,%s,'official_ats','Nigeria residents eligible',%s,'job','Nigeria eligible','verified')""",
      (job,url,suffix))
    contact=db.execute("""insert into ci_contacts
      (company_id,name,current_title,profile_url,profile_source_url,identity_verified)
      values(%s,'Morgan Recruiter','Recruiter',%s,%s,true) returning id""",
      (company,"https://example.org/contact/"+suffix,"https://example.org/team/"+suffix)).fetchone()[0]
    email="morgan-"+suffix+"@example.org"
    db.execute("""insert into ci_contact_methods
      (contact_id,method,value,verified,source_url)
      values(%s,'professional_email',%s,%s,%s)""",
      (contact,email,verified_email,"https://example.org/team/"+suffix))
    db.execute("""insert into ci_applications
      (owner_user_id,company_id,job_id,status,applied_at)
      values(%s,%s,%s,%s,%s)""",
      (owner,company,job,"applied" if applied else "saved",
       datetime.now(timezone.utc) if applied else None))
    draft=db.execute("""insert into ci_outreach_drafts
      (owner_user_id,job_id,contact_id,subject,body,knowledge_revision,status)
      values(%s,%s,%s,'Interest in backend engineering',
       'Hello Morgan, I applied for the engineering role and wanted to learn more about your team.',
       'revision-for-test','draft') returning id""",(owner,job,contact)).fetchone()[0]
    return owner,draft,email,company,job


def test_manual_approval_only_creates_one_pending_intent():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"],autocommit=True) as db:
        owner,draft,email,company,job=setup_draft(db)
        assert db.execute("select ci_prepare_outreach_intent(%s,%s)",(owner,draft)).fetchone()[0] is None
        assert db.execute("select ci_approve_outreach_draft(%s,%s,'manual')",(uuid4(),draft)).fetchone()[0] is False
        assert db.execute("select ci_approve_outreach_draft(%s,%s,'standing')",(owner,draft)).fetchone()[0] is False
        assert db.execute("select ci_approve_outreach_draft(%s,%s,'manual')",(owner,draft)).fetchone()[0] is True
        assert db.execute("select ci_approve_outreach_draft(%s,%s,'manual')",(owner,draft)).fetchone()[0] is True
        i1=db.execute("select ci_prepare_outreach_intent(%s,%s)",(owner,draft)).fetchone()[0]
        i2=db.execute("select ci_prepare_outreach_intent(%s,%s)",(owner,draft)).fetchone()[0]
        assert i1 is not None and i1==i2
        assert db.execute("select status from ci_outbound_messages where id=%s",(i1,)).fetchone()[0]=="pending"
        assert db.execute("select count(*) from ci_outbound_messages where draft_id=%s",(draft,)).fetchone()[0]==1
        # This milestone never calls an external provider or marks a message sent.


def test_no_application_or_unverified_email_never_approves():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"],autocommit=True) as db:
        for setup in ({"applied":False},{"verified_email":False},{"verified_eligibility":False}):
            owner,draft,_,_,_=setup_draft(db,**setup)
            assert db.execute("select ci_approve_outreach_draft(%s,%s,'manual')",(owner,draft)).fetchone()[0] is False
            assert db.execute("select ci_prepare_outreach_intent(%s,%s)",(owner,draft)).fetchone()[0] is None


def test_suppression_and_per_company_limits_block_further_intents():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"],autocommit=True) as db:
        owner,draft,email,company,job=setup_draft(db)
        db.execute("""insert into ci_suppression_records(owner_user_id,normalized_contact_hash,reason)
          values(%s,encode(sha256(convert_to(%s,'utf8')),'hex'),'opt_out')""",(owner,email))
        assert db.execute("select ci_approve_outreach_draft(%s,%s,'manual')",(owner,draft)).fetchone()[0] is False
        db.execute("delete from ci_suppression_records where owner_user_id=%s",(owner,))
        assert db.execute("select ci_approve_outreach_draft(%s,%s,'manual')",(owner,draft)).fetchone()[0] is True
        assert db.execute("select ci_prepare_outreach_intent(%s,%s)",(owner,draft)).fetchone()[0] is not None
        other=db.execute("""insert into ci_outreach_drafts
          (owner_user_id,job_id,contact_id,subject,body,knowledge_revision,status)
          select owner_user_id,job_id,contact_id,subject,body,knowledge_revision,'draft'
          from ci_outreach_drafts where id=%s returning id""",(draft,)).fetchone()[0]
        assert db.execute("select ci_approve_outreach_draft(%s,%s,'manual')",(owner,other)).fetchone()[0] is True
        assert db.execute("select ci_prepare_outreach_intent(%s,%s)",(owner,other)).fetchone()[0] is None


def test_browser_roles_cannot_call_authorization_functions():
    import psycopg
    with psycopg.connect(os.environ["PG_TEST_DSN"]) as db:
        for role in ("anon","authenticated"):
            for signature in ("ci_outreach_draft_ready(uuid,uuid)",
                              "ci_approve_outreach_draft(uuid,uuid,text)",
                              "ci_prepare_outreach_intent(uuid,uuid)"):
                assert db.execute("select has_function_privilege(%s,%s,'EXECUTE')",(role,signature)).fetchone()[0] is False
