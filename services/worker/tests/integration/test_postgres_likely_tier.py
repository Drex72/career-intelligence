"""Likely-eligible tier is separate from verified delivery and never pollutes it."""
import os
from datetime import date
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL required')


def _job(conn, status, label, published="now()"):
    cid = conn.execute(
        "insert into ci_companies(normalized_name,legal_name) values(%s,%s) returning id",
        ('likely-' + label, 'Likely ' + label)).fetchone()[0]
    url = 'https://example.org/likely/' + label
    jid = conn.execute(
        f"""insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,published_at)
            values(%s,'Backend Engineer',%s,%s,'open',{published}) returning id""",
        (cid, url, url)).fetchone()[0]
    conn.execute(
        """insert into ci_eligibility_assessments(job_id,status,confidence,reasons,contradictions,policy_version,expires_at)
           values(%s,%s,0.45,jsonb_build_array('Worldwide wording requires separate Nigeria hiring verification'),
                  '[]'::jsonb,'official-ats-v2',now()+interval '2 days')""", (jid, status))
    return cid, jid


def _tier(conn, owner):
    return {r[0]: r for r in conn.execute("select * from ci_likely_tier(%s,100)", (owner,)).fetchall()}


def test_likely_jobs_listed_separately_and_never_delivered():
    import psycopg
    owner = uuid4()
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as conn:
        _, likely = _job(conn, 'likely_eligible', uuid4().hex[:10])
        _, unknown = _job(conn, 'unknown', uuid4().hex[:10])
        _, stale = _job(conn, 'likely_eligible', uuid4().hex[:10], "now()-interval '20 days'")
        tier = _tier(conn, owner)
        assert likely in tier and unknown not in tier and stale not in tier
        row = tier[likely]
        assert row[6].startswith('Worldwide wording')
        assert row[9] is False and row[10] is False and row[11] is None
        # The strict verified batch must not pick up a likely job.
        conn.execute("select ci_generate_daily_batch(%s,%s,100)", (owner, date.today()))
        assert conn.execute(
            "select count(*) from ci_delivered_jobs where owner_user_id=%s and job_id=%s",
            (owner, likely)).fetchone()[0] == 0


def test_flags_show_missing_geo_evidence_without_gating():
    import psycopg
    owner = uuid4()
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as conn:
        cid, jid = _job(conn, 'likely_eligible', uuid4().hex[:10])
        conn.execute("""insert into ci_company_country_evidence(company_id,country,source_url)
                        values(%s,'US','https://example.org/about')""", (cid,))
        row = _tier(conn, owner)[jid]
        assert row[10] is True and row[9] is False


def test_decisions_confirm_keep_and_dismiss_hide_but_never_create_evidence():
    import psycopg
    owner = uuid4()
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as conn:
        _, jid = _job(conn, 'likely_eligible', uuid4().hex[:10])
        assert conn.execute("select ci_decide_likely_tier(%s,%s,'confirmed')", (owner, jid)).fetchone()[0]
        assert _tier(conn, owner)[jid][11] == 'confirmed'
        assert conn.execute("select count(*) from ci_eligibility_evidence where job_id=%s",
                            (jid,)).fetchone()[0] == 0
        assert conn.execute("""select status from ci_eligibility_assessments where job_id=%s
                               order by assessed_at desc limit 1""", (jid,)).fetchone()[0] == 'likely_eligible'
        assert conn.execute("select ci_decide_likely_tier(%s,%s,'dismissed')", (owner, jid)).fetchone()[0]
        assert jid not in _tier(conn, owner)
        # Another owner's view is unaffected.
        assert jid in _tier(conn, uuid4())


def test_decisions_rejected_for_non_likely_jobs_and_bad_values():
    import psycopg
    owner = uuid4()
    with psycopg.connect(os.environ['PG_TEST_DSN'], autocommit=True) as conn:
        _, unknown = _job(conn, 'unknown', uuid4().hex[:10])
        _, likely = _job(conn, 'likely_eligible', uuid4().hex[:10])
        assert conn.execute("select ci_decide_likely_tier(%s,%s,'confirmed')", (owner, unknown)).fetchone()[0] is False
        assert conn.execute("select ci_decide_likely_tier(%s,%s,'send')", (owner, likely)).fetchone()[0] is False


def test_tier_functions_not_callable_by_browser_roles():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as conn:
        for fn in ('ci_likely_tier(uuid,integer)', 'ci_decide_likely_tier(uuid,uuid,text)'):
            assert conn.execute(
                "select has_function_privilege('anon',%s,'EXECUTE'),has_function_privilege('authenticated',%s,'EXECUTE')",
                (fn, fn)).fetchone() == (False, False)
