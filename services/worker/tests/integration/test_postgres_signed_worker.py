"""HMAC-signed scheduler requests must be fresh, single-use and private."""
import os
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_signed_worker_request_has_strong_replay_and_expiry_controls():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        nonce=uuid4()
        now=int(db.execute('select extract(epoch from clock_timestamp())::bigint').fetchone()[0])
        signed=db.execute("""
          select encode(extensions.hmac(
            convert_to(%s||':'||%s,'UTF8'),convert_to(shared_key,'UTF8'),'sha256'),'hex')
          from ci_worker_auth where id=1
        """,(str(nonce),str(now))).fetchone()[0]
        assert len(signed)==64
        assert db.execute('select ci_verify_worker_request(%s,%s,%s)',
            (nonce,now,signed)).fetchone()[0] is True
        assert db.execute('select ci_verify_worker_request(%s,%s,%s)',
            (nonce,now,signed)).fetchone()[0] is False
        new=uuid4()
        assert db.execute('select ci_verify_worker_request(%s,%s,%s)',
            (new,now,signed)).fetchone()[0] is False
        assert db.execute('select ci_verify_worker_request(%s,%s,%s)',
            (uuid4(),now-3600,'0'*64)).fetchone()[0] is False

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_worker_secret_nonce_and_run_history_are_not_client_accessible():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            for name in ('ci_worker_auth','ci_worker_nonces','ci_worker_runs'):
                assert db.execute('select has_table_privilege(%s,%s,%s)',
                  (role,name,'SELECT')).fetchone()[0] is False
            assert db.execute("select has_function_privilege(%s,'ci_verify_worker_request(uuid,bigint,text)','EXECUTE')",(role,)).fetchone()[0] is False
            assert db.execute("select has_function_privilege(%s,'ci_emit_signed_worker_request()','EXECUTE')",(role,)).fetchone()[0] is False
        assert db.execute('select count(*) from ci_worker_auth').fetchone()[0]==1
