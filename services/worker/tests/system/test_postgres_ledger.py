import os
from uuid import uuid4
import pytest
from career.orchestration.postgres_ledger import PostgresTaskLedger


def test_pg_ledger_requires_configured_url():
    with pytest.raises(ValueError,match='DATABASE_URL'):
        PostgresTaskLedger('')


@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='PostgreSQL integration instance not configured')
def test_pg_ledger_claim_complete_and_restart():
    # Requires migrations and a disposable test schema. Never target live data.
    dsn=os.environ['PG_TEST_DSN'];key='test-'+str(uuid4())
    with PostgresTaskLedger(dsn) as ledger:
        task=ledger.enqueue('test',key,{'sample':1})
        assert ledger.enqueue('test',key,{'sample':1})==task
        claimed=ledger.claim('tester',lease_seconds=10)
        assert claimed and claimed['id']==task
        ledger.complete(task,'tester',{'ok':True})
    with PostgresTaskLedger(dsn) as ledger:
        assert ledger.task(task)['state']=='completed'


@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='PostgreSQL integration instance not configured')
def test_pg_exhausted_expired_lease_reaches_terminal_failure():
    dsn=os.environ['PG_TEST_DSN'];key='exhausted-'+str(uuid4())
    with PostgresTaskLedger(dsn) as ledger:
        task=ledger.enqueue('test',key,{'sample':'lease'},max_attempts=1)
        assert ledger.claim('failed-worker',lease_seconds=1)['id']==task
        with ledger.conn.transaction():
            ledger.conn.execute("UPDATE ci_workflow_tasks SET lease_until=now()-interval '1 second' WHERE id=%s",(task,))
        assert ledger.claim('recovery-worker') is None
        assert ledger.task(task)['state']=='failed'
        events=ledger.conn.execute("SELECT event_type FROM ci_task_events WHERE task_id=%s ORDER BY id",(task,)).fetchall()
        assert events[-1]['event_type']=='failed'
