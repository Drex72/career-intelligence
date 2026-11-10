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
