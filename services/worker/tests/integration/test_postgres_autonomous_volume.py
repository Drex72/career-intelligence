"""Volume and autonomy: employer-stated worldwide postings deliver with their own
basis, searches restart every 2 hours, and due searches count as discovery work."""
import os
from datetime import date
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL required')


def _owner(db, employer=None, keywords=(), country='NG'):
    owner = uuid4()
    db.execute("insert into auth.users(id) values(%s) on conflict do nothing", (owner,))
    db.execute("insert into ci_workspace_owners(owner_user_id) values(%s)", (owner,))
    assert db.execute("select ci_save_geo_target(%s,%s,%s,%s)",
                      (owner, country, employer, list(keywords))).fetchone()[0]
    return owner


def _official(db, status='likely_eligible', scope='worldwide', published="now()", title='Backend Engineer', company=None):
    slug = uuid4().hex[:10]
    if company is None:
        company = db.execute("insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
                             ('vol-' + slug, 'Vol ' + slug)).fetchone()[0]
    url = 'https://boards.greenhouse.io/vol' + slug + '/jobs/1'
    job = db.execute(f"""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
        values(%s,%s,%s,%s,'open',{published}) returning id""", (company, title, url, url)).fetchone()[0]
    db.execute("""insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
        values(%s,%s,0.5,'[]','[]','test',now()+interval '2 days')""", (job, status))
    if scope:
        db.execute("""insert into ci_job_remote_scope_evidence(job_id,scope,source_url,expires_at)
            values(%s,%s,%s,now()+interval '2 days')""", (job, scope, url))
    return company, job


def _delivered(db, owner):
    db.execute("select ci_generate_daily_batch(%s,%s,100)", (owner, date.today()))
    return {r[0]: r[1] for r in db.execute(
        """select i.job_id,i.eligibility_basis from ci_daily_batch_items i
           join ci_daily_batches b on b.id=i.batch_id where b.owner_user_id=%s""", (owner,)).fetchall()}


def test_employer_worldwide_delivers_with_its_own_basis():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db)
        _, worldwide = _official(db)
        _, restricted = _official(db, scope='restricted')
        _, no_scope = _official(db, scope=None)
        _, ineligible = _official(db, status='ineligible')
        _, stale = _official(db, published="now()-interval '9 days'")
        got = _delivered(db, owner)
        assert got.get(worldwide) == 'employer_worldwide'
        for job in (restricted, no_scope, ineligible, stale):
            assert job not in got


def test_dismissed_and_employer_country_and_keywords_still_gate():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db, keywords=['backend'])
        _, dismissed = _official(db)
        assert db.execute("select ci_decide_likely_tier(%s,%s,'dismissed')", (owner, dismissed)).fetchone()[0]
        _, designer = _official(db, title='Product Designer')
        got = _delivered(db, owner)
        assert dismissed not in got and designer not in got
        strict = _owner(db, employer='US')
        company, job = _official(db)
        assert job not in _delivered(db, strict)
        db.execute("""insert into ci_company_country_evidence(company_id,country,source_url)
            values(%s,'US','https://example.org/about')""", (company,))
        assert _delivered(db, strict).get(job) == 'employer_worldwide'


def test_new_role_at_already_recommended_employer_is_delivered_once():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db)
        company, first = _official(db)
        assert first in _delivered(db, owner)
        _, second = _official(db, title='Platform Engineer', company=company)
        got = _delivered(db, owner)
        assert second in got
        assert db.execute("""select count(*) from ci_daily_batch_items i join ci_daily_batches b on b.id=i.batch_id
            where b.owner_user_id=%s and i.job_id=%s""", (owner, first)).fetchone()[0] == 1


def test_search_walk_restarts_after_two_hours():
    import psycopg
    key = 'himalayas:ZZ:' + uuid4().hex[:8]
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] == 1
        db.execute("select ci_advance_source_query(%s,0)", (key,))
        db.execute("""update ci_source_query_progress set last_run_at=now()-interval '2 minutes',
            cycle_started_at=now()-interval '1 hour' where query_key=%s""", (key,))
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] is None
        db.execute("""update ci_source_query_progress set cycle_started_at=now()-interval '121 minutes'
            where query_key=%s""", (key,))
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] == 1


def test_due_searches_count_as_discovery_work():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        before = db.execute("select ci_job_board_queries_due()").fetchone()[0]
        kw = ['kw' + uuid4().hex[:6], 'kw' + uuid4().hex[:6]]
        _owner(db, keywords=kw, country='KE')
        assert db.execute("select ci_job_board_queries_due()").fetchone()[0] == before + 2
        db.execute("select ci_claim_source_query(%s,600)", ('himalayas:KE:' + kw[0],))
        assert db.execute("select ci_job_board_queries_due()").fetchone()[0] == before + 1
        plan = db.execute("select ci_specialist_pool_plan()").fetchone()[0]
        discovery = next(r for r in plan['roles'] if r['role'] == 'discovery')
        assert discovery['queued'] >= before + 1


def test_new_functions_are_private():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon', 'authenticated'):
            for fn in ('ci_job_employer_worldwide_allows(uuid,uuid)', 'ci_job_board_queries_due()'):
                assert db.execute("select has_function_privilege(%s,%s,'EXECUTE')", (role, fn)).fetchone()[0] is False
