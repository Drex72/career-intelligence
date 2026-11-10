"""Only exercises a disposable database; never runs against Groundwork production."""
from datetime import datetime, timezone, timedelta
from uuid import uuid4
import os
import pytest


@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL test DB missing')
def test_remotive_atomic_ingestion_is_unverified_idempotent_and_bounded():
    import psycopg
    token=uuid4().hex[:8]
    source_url=f'https://remotive.com/remote-jobs/software-dev/backend-engineer-{token}'
    pub=datetime.now(timezone.utc)
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as conn:
        assert conn.execute("select ci_claim_feed_slot('unapproved-source')").fetchone()[0] is False
        assert conn.execute("select ci_claim_feed_slot('remotive')").fetchone()[0] is True
        assert conn.execute("select ci_claim_feed_slot('remotive')").fetchone()[0] is False
        params=(str(int(token,16)),f'Source Test {token}','Backend Engineer',source_url,pub,'Worldwide')
        first=conn.execute('select ci_ingest_remotive_job(%s,%s,%s,%s,%s,%s)',params).fetchone()[0]
        second=conn.execute('select ci_ingest_remotive_job(%s,%s,%s,%s,%s,%s)',params).fetchone()[0]
        assert first is not None and first == second
        status=conn.execute('select status from ci_jobs where id=%s',(first,)).fetchone()[0]
        assert status=='unverified'
        source=conn.execute('select source_name from ci_job_sources where job_id=%s',(first,)).fetchone()[0]
        assert source=='remotive'
        stale=conn.execute('select ci_ingest_remotive_job(%s,%s,%s,%s,%s,%s)',
            (params[0]+'2',params[1],'Backend Engineer',source_url, pub-timedelta(days=9),'Worldwide')).fetchone()[0]
        assert stale is None
