"""Postings the employer took down are closed and leave the eligibility queue; boards that
answer "not found" three scans in a row are paused, and a good scan resets the count."""
import os
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL required')


def _board(db):
    slug = 'ci' + uuid4().hex[:10]
    sid = db.execute("""insert into ci_discovery_sources(name,kind,state,config)
        values(%s,'ats','active',%s::jsonb) returning id""",
        ('ats:greenhouse:' + slug, '{"provider":"greenhouse"}')).fetchone()[0]
    return slug, sid


def _job(db, slug):
    url = f'https://job-boards.greenhouse.io/{slug}/jobs/12345'
    job = db.execute("select ci_ingest_ats_job('greenhouse',%s,'12345',%s,'Software Engineer',%s,null,'Remote')",
                     (slug, 'Co ' + slug, url)).fetchone()[0]
    return job, url


def test_missing_posting_is_closed_and_leaves_the_queue():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        slug, _ = _board(db)
        job, url = _job(db, slug)
        assert db.execute("select state from ci_eligibility_review_queue where job_id=%s", (job,)).fetchone()[0] == 'pending'
        assert db.execute("select ci_close_missing_posting(%s,'https://evil.example/x')", (job,)).fetchone()[0] is False
        assert db.execute("select status from ci_jobs where id=%s", (job,)).fetchone()[0] == 'open'
        assert db.execute("select ci_close_missing_posting(%s,%s)", (job, url)).fetchone()[0] is True
        assert db.execute("select status from ci_jobs where id=%s", (job,)).fetchone()[0] == 'closed'
        assert db.execute("select state from ci_eligibility_review_queue where job_id=%s", (job,)).fetchone()[0] == 'blocked'


def test_board_paused_after_three_misses_and_reset_by_success():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        _, sid = _board(db)
        assert db.execute("select ci_record_board_missing(%s)", (sid,)).fetchone()[0] == 'active'
        assert db.execute("select ci_record_board_missing(%s)", (sid,)).fetchone()[0] == 'active'
        assert db.execute("select ci_reset_board_missing(%s)", (sid,)).fetchone()[0] is True
        assert db.execute("select rate_limit_json ? 'missing_count' from ci_discovery_sources where id=%s",
                          (sid,)).fetchone()[0] is False
        for expected in ('active', 'active', 'paused'):
            assert db.execute("select ci_record_board_missing(%s)", (sid,)).fetchone()[0] == expected
        assert db.execute("select state from ci_discovery_sources where id=%s", (sid,)).fetchone()[0] == 'paused'
        assert db.execute("select ci_claim_ats_slot(%s)", (sid,)).fetchone()[0] is False
        assert db.execute("select ci_record_board_missing(%s)", (sid,)).fetchone()[0] is None


def test_new_functions_are_private():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon', 'authenticated'):
            for fn in ('ci_close_missing_posting(uuid,text)', 'ci_record_board_missing(uuid)',
                       'ci_reset_board_missing(uuid)'):
                assert db.execute("select has_function_privilege(%s,%s,'EXECUTE')", (role, fn)).fetchone()[0] is False
