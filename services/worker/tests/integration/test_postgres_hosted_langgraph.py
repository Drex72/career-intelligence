"""Real hosted LangGraph startup and PostgreSQL checkpointer smoke test.

This test deliberately runs --dry-run: no Supabase network call or real job change.
"""
import os
import pytest

from career.graph import AGENT_ROLES
from career.hosted_langgraph import run_service

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'), reason='PostgreSQL test instance required')
@pytest.mark.parametrize('role',AGENT_ROLES)
def test_each_persistent_role_boots_checkpointed_graph_and_stops_safely(monkeypatch,role):
    import psycopg
    dsn=os.environ['PG_TEST_DSN']
    monkeypatch.setenv('DATABASE_URL',dsn)
    monkeypatch.setenv('CI_WORKER_ENDPOINT','https://test-ref.supabase.co/functions/v1/ci-worker')
    monkeypatch.setenv('CI_LANGGRAPH_ENABLED','false')
    monkeypatch.delenv('CI_WORKER_SIGNING_KEY',raising=False)
    assert run_service(role,once=True,dry_run=True)==0
    with psycopg.connect(dsn) as conn:
        row=conn.execute(
            """select state from ci_langgraph.runtime_processes
            where role=%s order by last_heartbeat_at desc limit 1""",(role,)
        ).fetchone()
        assert row and row[0]=='stopped'
        assert conn.execute(
            """select count(*) from information_schema.tables
            where table_schema='ci_langgraph' and table_name='checkpoints'"""
        ).fetchone()[0]==1
