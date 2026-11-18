"""Country-configurable targeting: owner settings decide the country, job-board
location rules deliver with a labelled basis, official negatives always win."""
import os
from datetime import date
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL required')


def _owner(db, country='NG', employer=None, keywords=()):
    owner = uuid4()
    db.execute("insert into auth.users(id) values(%s) on conflict do nothing", (owner,))
    db.execute("insert into ci_workspace_owners(owner_user_id) values(%s)", (owner,))
    assert db.execute("select ci_save_geo_target(%s,%s,%s,%s)",
                      (owner, country, employer, list(keywords))).fetchone()[0] is True
    return owner


def _board_job(db, title='Backend Engineer', worldwide=False, countries=('NG',), updated="now()"):
    slug = uuid4().hex[:10]
    company = db.execute("insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
                         ('ctry-' + slug, 'Country ' + slug)).fetchone()[0]
    guid = 'https://himalayas.app/companies/c' + slug + '/jobs/j' + slug
    apply = 'https://example.org/apply/' + slug
    job = db.execute(f"""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,updated_at)
        values(%s,%s,%s,%s,'unverified',{updated}) returning id""", (company, title, apply, apply)).fetchone()[0]
    db.execute("""insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
        values(%s,'himalayas',%s,%s)""", (job, guid, guid))
    assert db.execute("select ci_record_job_location_rule(%s,'himalayas',%s,%s,%s)",
                      (job, guid, worldwide, list(countries))).fetchone()[0] is True
    return company, job


def _delivered(db, owner):
    db.execute("select ci_generate_daily_batch(%s,%s,100)", (owner, date.today()))
    return {r[0]: r[1] for r in db.execute(
        """select i.job_id,i.eligibility_basis from ci_daily_batch_items i
           join ci_daily_batches b on b.id=i.batch_id where b.owner_user_id=%s""", (owner,)).fetchall()}


def test_job_board_rule_delivers_for_configured_country_with_basis():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db, 'GH')
        _, listed = _board_job(db, countries=('GH', 'NG'))
        _, worldwide = _board_job(db, worldwide=True, countries=())
        _, other = _board_job(db, countries=('US', 'CA'))
        got = _delivered(db, owner)
        assert got.get(listed) == 'job_board'
        assert got.get(worldwide) == 'job_board'
        assert other not in got


def test_official_negative_expired_rule_and_stale_jobs_never_deliver():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db, 'NG')
        _, negative = _board_job(db)
        db.execute("""insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version)
            values(%s,'ineligible',0.98,'[]','[]','test')""", (negative,))
        _, expired = _board_job(db)
        db.execute("update ci_job_location_rules set expires_at=now()-interval '1 minute' where job_id=%s", (expired,))
        _, stale = _board_job(db, updated="now()-interval '9 days'")
        got = _delivered(db, owner)
        assert negative not in got and expired not in got and stale not in got


def test_employer_country_is_optional_and_evidence_gated_when_set():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        strict = _owner(db, 'NG', 'US')
        company, job = _board_job(db)
        assert job not in _delivered(db, strict)
        db.execute("""insert into ci_company_country_evidence(company_id,country,source_url)
            values(%s,'US','https://example.org/about')""", (company,))
        assert _delivered(db, strict).get(job) == 'job_board'
        relaxed = _owner(db, 'NG', None)
        _, other = _board_job(db)
        assert _delivered(db, relaxed).get(other) == 'job_board'


def test_role_keywords_filter_titles():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db, 'NG', None, ['Backend', 'platform engineer'])
        _, backend = _board_job(db, 'Senior Backend Engineer')
        _, designer = _board_job(db, 'Product Designer')
        got = _delivered(db, owner)
        assert backend in got and designer not in got


def test_settings_validation_and_rule_requires_matching_source():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        owner = _owner(db)
        for bad in (('ng', None, []), ('NGA', None, []), ('NG', 'usa', []),
                    ('NG', None, ['x']), ('NG', None, ['drop;table']), ('NG', None, ['a1'] * 9)):
            assert db.execute("select ci_save_geo_target(%s,%s,%s,%s)", (owner, *bad)).fetchone()[0] is False
        assert db.execute("select ci_save_geo_target(%s,'NG',null,'{}')", (uuid4(),)).fetchone()[0] is False
        _, job = _board_job(db)
        assert db.execute("""select ci_record_job_location_rule(%s,'himalayas','https://evil.example/x',true,'{}')""",
                          (job,)).fetchone()[0] is False
        guid = db.execute("select source_url from ci_job_sources where job_id=%s", (job,)).fetchone()[0]
        assert db.execute("select ci_record_job_location_rule(%s,'himalayas',%s,false,'{}')",
                          (job, guid)).fetchone()[0] is False
        assert db.execute("select ci_record_job_location_rule(%s,'himalayas',%s,false,%s)",
                          (job, guid, ['Nigeria'])).fetchone()[0] is False


def test_source_query_walk_resumes_and_finishes():
    import psycopg
    key = 'himalayas:test:' + uuid4().hex[:8]
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as db:
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] == 1
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] is None  # cooling down
        db.execute("select ci_advance_source_query(%s,6)", (key,))
        db.execute("update ci_source_query_progress set last_run_at=now()-interval '2 minutes' where query_key=%s", (key,))
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] == 6
        db.execute("select ci_advance_source_query(%s,0)", (key,))
        db.execute("update ci_source_query_progress set last_run_at=now()-interval '2 minutes' where query_key=%s", (key,))
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] is None  # walk done
        db.execute("""update ci_source_query_progress set cycle_started_at=now()-interval '25 hours',
            last_run_at=now()-interval '2 minutes' where query_key=%s""", (key,))
        assert db.execute("select ci_claim_source_query(%s,60)", (key,)).fetchone()[0] == 1  # new day


def test_new_objects_are_private():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon', 'authenticated'):
            for table in ('ci_job_location_rules', 'ci_source_query_progress'):
                assert db.execute("select has_table_privilege(%s,%s,'SELECT')", (role, table)).fetchone()[0] is False
            for fn in ('ci_save_geo_target(uuid,text,text,text[])',
                       'ci_record_job_location_rule(uuid,text,text,boolean,text[])',
                       'ci_claim_source_query(text,integer)', 'ci_advance_source_query(text,integer)',
                       'ci_job_location_rule_allows(uuid,uuid)', 'ci_job_matches_role_keywords(uuid,uuid)',
                       'ci_generate_daily_batch(uuid,date,integer)'):
                assert db.execute("select has_function_privilege(%s,%s,'EXECUTE')", (role, fn)).fetchone()[0] is False
