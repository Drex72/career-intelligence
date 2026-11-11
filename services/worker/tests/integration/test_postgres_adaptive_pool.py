"""Adaptive pool must be bounded, deterministic, private, and dry-run safe."""
import os
import pytest

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_adaptive_ceiling_scales_down_at_eighty_and_stops_at_target():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        examples=[(0,10),(79,10),(80,5),(81,5),(99,5),(100,0)]
        for already,expected in examples:
            actual=db.execute(
              "select ci_worker_pool_ceiling(%s,100,10,5,80)",(already,)
            ).fetchone()[0]
            assert actual==expected,(already,actual)

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_pool_dry_run_is_pure_and_counts_backlog_without_dispatch():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        before=db.execute("select count(*) from ci_worker_pool_waves").fetchone()[0]
        data=db.execute("select ci_run_adaptive_worker_pool(true)").fetchone()[0]
        after=db.execute("select count(*) from ci_worker_pool_waves").fetchone()[0]
        assert before==after
        assert data['dry_run'] is True
        assert data['dispatched']==0
        assert 0<=data['desired']<=10
        assert data['desired']<=data['ceiling']
        assert data['due_boards']>=0
        assert data['pending_reviews']>=0
        assert data['pending_matches']>=0
        assert data['remaining']>=0

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_parallel_pool_functions_and_metrics_are_not_exposed_to_web_roles():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            for table in ('ci_worker_pool_config','ci_worker_pool_waves'):
                assert db.execute('select has_table_privilege(%s,%s,%s)',
                    (role,table,'SELECT')).fetchone()[0] is False
            for signature in ('ci_worker_pool_plan()',
              'ci_run_adaptive_worker_pool(boolean)',
              'ci_worker_pool_ceiling(integer,integer,integer,integer,integer)'):
                assert db.execute('select has_function_privilege(%s,%s,%s)',
                    (role,signature,'EXECUTE')).fetchone()[0] is False
        assert db.execute("select relrowsecurity from pg_class where oid='ci_worker_pool_waves'::regclass").fetchone()[0]

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_pool_capacity_cannot_exceed_ten():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        with pytest.raises(psycopg.errors.CheckViolation):
            with db.transaction():
                db.execute("update ci_worker_pool_config set max_instances=11 where id=1")
        cfg=db.execute("select max_instances,reduced_instances from ci_worker_pool_config where id=1").fetchone()
        assert cfg[0]<=10 and cfg[1]<=cfg[0]
