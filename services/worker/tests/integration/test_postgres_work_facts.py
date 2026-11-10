"""Official ATS work and visa facts require recent, source-matched evidence."""
import os
from uuid import uuid4
import pytest

pytestmark=pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')

def test_trusted_ats_excerpt_required_for_work_fact_recording():
    import psycopg
    x=uuid4().hex[:9]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        cid=db.execute("insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
            ('workfact-'+x,'WorkFacts '+x)).fetchone()[0]
        url=f'https://job-boards.greenhouse.io/example/jobs/{x}'
        jid=db.execute("""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status)
          values(%s,'Backend Engineer',%s,%s,'open') returning id""",(cid,url,url)).fetchone()[0]
        db.execute("""insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
          values(%s,'greenhouse',%s,%s)""",(jid,'example:'+x,url))
        excerpt='This position is fully remote. Visa sponsorship is provided.'
        assert db.execute("""select ci_record_ats_work_facts(%s,%s,%s,'remote','confirmed')""",
              (jid,url,excerpt)).fetchone()[0] is False
        db.execute("""insert into ci_eligibility_evidence
          (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
          values(%s,%s,'official_ats',%s,md5(%s),'job','Official ATS description','verified')""",
          (jid,url,excerpt,excerpt))
        assert db.execute("""select ci_record_ats_work_facts(%s,%s,%s,'remote','confirmed')""",
          (jid,'https://evil.example/job',excerpt)).fetchone()[0] is False
        assert db.execute("""select ci_record_ats_work_facts(%s,%s,%s,'remote','confirmed')""",
          (jid,url,'Unrelated excerpt')).fetchone()[0] is False
        assert db.execute("""select ci_record_ats_work_facts(%s,%s,%s,'remote','confirmed')""",
          (jid,url,excerpt)).fetchone()[0] is True
        assert db.execute("select work_mode,sponsorship from ci_job_work_facts where job_id=%s",
          (jid,)).fetchone()==('remote','confirmed')

def test_work_fact_rpc_is_server_only():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert db.execute("""select has_function_privilege(%s,
            'ci_record_ats_work_facts(uuid,text,text,text,text)','EXECUTE')""",
            (role,)).fetchone()[0] is False
