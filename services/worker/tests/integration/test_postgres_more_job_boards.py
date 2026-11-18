"""More job boards: Jobicy and We Work Remotely ingest with strict URL checks, every board
can record a location rule, delivery labels the board, and feed slots count as discovery work."""
import os
from datetime import date
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL required')


def _owner(db, country='NG'):
    owner = uuid4()
    db.execute("insert into auth.users(id) values(%s) on conflict do nothing", (owner,))
    db.execute("insert into ci_workspace_owners(owner_user_id) values(%s)", (owner,))
    assert db.execute("select ci_save_geo_target(%s,%s,%s,%s)", (owner, country, None, [])).fetchone()[0]
    return owner


def _ingest(db, source, title='Backend Engineer'):
    slug = uuid4().hex[:10]
    if source == 'jobicy':
        sid, url = str(int(slug, 16) % 10**9), 'https://jobicy.com/jobs/' + slug + '-backend'
    else:
        sid, url = 'co-' + slug, 'https://weworkremotely.com/remote-jobs/co-' + slug
    job = db.execute("select ci_ingest_board_job(%s,%s,%s,%s,%s,now(),%s)",
                     (source, sid, 'Board Co ' + slug, title, url, 'Anywhere')).fetchone()[0]
    return job, url


def test_board_ingest_validates_source_urls():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        for source in ('jobicy', 'weworkremotely'):
            job, url = _ingest(db, source)
            assert job is not None
            row = db.execute("select apply_url,status,timestamp_source from ci_jobs where id=%s", (job,)).fetchone()
            assert row == (url, 'unverified', source)
        bad = [('jobicy', '12', 'https://evil.example/jobs/12'),
               ('jobicy', 'abc', 'https://jobicy.com/jobs/abc'),
               ('weworkremotely', 'x-1', 'https://weworkremotely.com/remote-jobs/other'),
               ('unknown', '1', 'https://jobicy.com/jobs/1')]
        for source, sid, url in bad:
            assert db.execute("select ci_ingest_board_job(%s,%s,'Acme','Backend Engineer',%s,now(),'')",
                              (source, sid, url)).fetchone()[0] is None
        assert db.execute("""select ci_ingest_board_job('jobicy','5','Acme','Backend Engineer',
            'https://jobicy.com/jobs/5-x',now()-interval '9 days','')""").fetchone()[0] is None


def test_every_board_records_rules_and_delivers_labelled():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db)
        delivered = {}
        for source in ('jobicy', 'weworkremotely'):
            job, url = _ingest(db, source)
            assert db.execute("select ci_record_job_location_rule(%s,%s,%s,true,'{}')",
                              (job, source, url)).fetchone()[0] is True
            delivered[job] = source
        # A rule naming a board the job did not come from is refused.
        mismatched, url = _ingest(db, 'jobicy')
        assert db.execute("select ci_record_job_location_rule(%s,'weworkremotely',%s,true,'{}')",
                          (mismatched, url)).fetchone()[0] is False
        # A country list without the applicant's country does not deliver.
        us_job, us_url = _ingest(db, 'weworkremotely')
        assert db.execute("select ci_record_job_location_rule(%s,'weworkremotely',%s,false,array['US'])",
                          (us_job, us_url)).fetchone()[0] is True
        db.execute("select ci_generate_daily_batch(%s,%s,100)", (owner, date.today()))
        got = {r[0]: (r[1], r[2]) for r in db.execute(
            """select i.job_id,i.eligibility_basis,r.source_name from ci_daily_batch_items i
               join ci_daily_batches b on b.id=i.batch_id
               left join ci_job_location_rules r on r.job_id=i.job_id
               where b.owner_user_id=%s""", (owner,)).fetchall()}
        for job, source in delivered.items():
            assert got.get(job) == ('job_board', source)
        assert us_job not in got and mismatched not in got


def test_remotive_rule_allowed():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        sid = str(int(uuid4().hex[:8], 16))
        url = 'https://remotive.com/remote-jobs/software-dev/backend-' + sid
        job = db.execute("select ci_ingest_remotive_job(%s,%s,'Backend Engineer',%s,now(),'Worldwide')",
                         (sid, 'Remotive Co ' + sid, url)).fetchone()[0]
        assert db.execute("select ci_record_job_location_rule(%s,'remotive',%s,true,'{}')",
                          (job, url)).fetchone()[0] is True


def test_feed_slots_cooldowns_and_demand():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        db.execute("delete from ci_api_rate_limits where action in ('jobicy','weworkremotely')")
        before = db.execute("select ci_job_board_queries_due()").fetchone()[0]
        assert db.execute("select ci_claim_feed_slot('jobicy')").fetchone()[0] is True
        assert db.execute("select ci_claim_feed_slot('jobicy')").fetchone()[0] is False
        assert db.execute("select ci_job_board_queries_due()").fetchone()[0] == before - 1
        db.execute("update ci_api_rate_limits set last_run_at=now()-interval '121 minutes' where action='jobicy'")
        assert db.execute("select ci_claim_feed_slot('jobicy')").fetchone()[0] is True
        assert db.execute("select ci_claim_feed_slot('weworkremotely')").fetchone()[0] is True
        db.execute("update ci_api_rate_limits set last_run_at=now()-interval '61 minutes' where action='weworkremotely'")
        assert db.execute("select ci_claim_feed_slot('weworkremotely')").fetchone()[0] is True
        assert db.execute("select ci_claim_feed_slot('nope')").fetchone()[0] is False


def test_new_functions_are_private():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon', 'authenticated'):
            for fn in ('ci_ingest_board_job(text,text,text,text,text,timestamptz,text)', 'ci_feed_cooldown(text)'):
                assert db.execute("select has_function_privilege(%s,%s,'EXECUTE')", (role, fn)).fetchone()[0] is False
