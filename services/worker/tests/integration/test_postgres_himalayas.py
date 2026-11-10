"""Himalayas jobs are attributed, fresh, idempotent and never auto-eligible."""
import os
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated Postgres needed')
def test_himalayas_ingestion_preserves_apply_link_and_attribution():
 import psycopg
 slug=uuid4().hex[:10]
 company='Himalayas Integration '+slug
 guid='https://himalayas.app/companies/'+slug+'/jobs/backend-engineer'
 apply='https://boards.greenhouse.io/'+slug+'/jobs/123?gh_src=himalayas'
 with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
  p=(guid,company,'Backend Engineer',apply,None,'Location restrictions: NG')
  assert db.execute("select ci_claim_feed_slot('himalayas')").fetchone()[0] is True
  assert db.execute("select ci_claim_feed_slot('himalayas')").fetchone()[0] is False
  assert db.execute("select ci_claim_feed_slot('unknown_source')").fetchone()[0] is False
  p=(guid,company,'Backend Engineer',apply,db.execute('select now()').fetchone()[0],'Location restrictions: NG')
  job=db.execute("select ci_ingest_himalayas_job(%s,%s,%s,%s,%s,%s)",p).fetchone()[0]
  assert job
  assert db.execute("select ci_ingest_himalayas_job(%s,%s,%s,%s,%s,%s)",p).fetchone()[0]==job
  values=db.execute('select apply_url,status,remote_text from ci_jobs where id=%s',(job,)).fetchone()
  assert values==(apply,'unverified','Location restrictions: NG')
  stamped=db.execute('select published_at,updated_at,timestamp_source,timestamp_confidence from ci_jobs where id=%s',(job,)).fetchone()
  assert stamped[0] is None, 'Himalayas pubDate must not masquerade as original posting date'
  assert stamped[1]==p[4]
  assert stamped[2]=='himalayas_pubDate_last_updated'
  assert stamped[3]=='unknown'
  ref=db.execute("select source_name,source_url from ci_job_sources where job_id=%s",(job,)).fetchone()
  assert ref==('himalayas',guid)
  assert db.execute('select count(*) from ci_eligibility_assessments where job_id=%s',(job,)).fetchone()[0]==0
  bad=('https://himalayas.app.evil.test/companies/'+slug+'/jobs/role',company,'Engineer',apply,p[4],'NG')
  assert db.execute("select ci_ingest_himalayas_job(%s,%s,%s,%s,%s,%s)",bad).fetchone()[0] is None

@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated Postgres needed')
def test_himalayas_feed_is_server_role_only():
 import psycopg
 with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
  for role in ('anon','authenticated'):
   assert db.execute("select has_function_privilege(%s,'ci_ingest_himalayas_job(text,text,text,text,timestamptz,text)','EXECUTE')",(role,)).fetchone()[0] is False
   assert db.execute("select has_function_privilege(%s,'ci_claim_feed_slot(text)','EXECUTE')",(role,)).fetchone()[0] is False
