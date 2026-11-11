"""Authenticated specialist fan-out must be role-scoped and demand-driven."""
import os
from uuid import uuid4
import pytest

ROLES=('eligibility','matching','discovery','people','outreach','conversation')

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_signed_role_cannot_be_replayed_or_mutated():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        nonce=uuid4()
        stamp=int(db.execute('select extract(epoch from clock_timestamp())::bigint').fetchone()[0])
        sig=db.execute("""
          select encode(extensions.hmac(
            convert_to(%s||':'||%s||':'||%s,'UTF8'),
            convert_to(shared_key,'UTF8'),'sha256'),'hex')
          from ci_worker_auth where id=1
        """,(str(nonce),str(stamp),'discovery')).fetchone()[0]
        assert db.execute('select ci_verify_specialist_request(%s,%s,%s,%s)',
                          (nonce,stamp,sig,'matching')).fetchone()[0] is False
        assert db.execute('select ci_verify_specialist_request(%s,%s,%s,%s)',
                          (nonce,stamp,sig,'discovery')).fetchone()[0] is True
        assert db.execute('select ci_verify_specialist_request(%s,%s,%s,%s)',
                          (nonce,stamp,sig,'discovery')).fetchone()[0] is False

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_specialist_plan_has_six_distinct_independently_sized_lanes_and_is_read_only():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        db.execute('update ci_specialist_pool_config set enabled=true where id=1')
        before=db.execute('select count(*) from ci_specialist_pool_waves').fetchone()[0]
        plan=db.execute('select ci_run_specialist_pool(true)').fetchone()[0]
        after=db.execute('select count(*) from ci_specialist_pool_waves').fetchone()[0]
        assert before==after
        assert plan['dry_run'] is True and plan['launched']==0
        roles=plan['roles']
        assert tuple(r['role'] for r in roles)==ROLES
        assert sum(r['spawn'] for r in roles)<=plan['dispatch_budget']
        assert sum(r['spawn'] for r in roles)<=max(0,plan['active_budget']-plan['active_total'])
        for role in roles:
            assert role['queued']>=0 and role['active']>=0
            assert role['desired']>=0 and role['spawn']>=0
            assert role['spawn']<=max(0,role['desired']-role['active'])
        db.rollback()

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_specialist_queue_scales_from_real_backlog_not_delivery_thresholds():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        db.execute('update ci_specialist_pool_config set enabled=true,active_budget=32,dispatch_budget=32 where id=1')
        # A fresh approved source must be visible to Discovery independently
        # from any existing delivered-job counter.
        source=db.execute("""
          insert into ci_discovery_sources(name,kind,state,config)
          values(%s,'ats','active',%s::jsonb)
          returning id
        """,('ats:lever:autoscale-'+uuid4().hex[:10],
             '{"provider":"lever","slug":"autoscale-test","company_name":"Autoscale Test"}')).fetchone()[0]
        plan=db.execute('select ci_specialist_pool_plan()').fetchone()[0]
        disc=next(r for r in plan['roles'] if r['role']=='discovery')
        assert disc['queued']>=1
        assert disc['desired']>=1
        assert disc['throughput_per_run']==6
        db.rollback()

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_private_specialist_pool_and_role_signing_cannot_be_called_by_web_roles():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            for table in ('ci_specialist_pool_config','ci_specialist_pool_waves'):
                assert not db.execute('select has_table_privilege(%s,%s,%s)',
                                      (role,table,'SELECT')).fetchone()[0]
            for signature in (
              'ci_verify_specialist_request(uuid,bigint,text,text)',
              'ci_emit_specialist_request(text)',
              'ci_run_specialist_pool(boolean)',
              'ci_specialist_pool_plan()'):
                assert not db.execute('select has_function_privilege(%s,%s,%s)',
                                      (role,signature,'EXECUTE')).fetchone()[0]

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='isolated PostgreSQL required')
def test_idle_specialist_canary_does_not_corrupt_measured_throughput():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        before=db.execute('select ci_specialist_pool_plan()').fetchone()[0]
        lane=lambda p:next(x for x in p['roles'] if x['role']=='discovery')
        normal=lane(before)['throughput_per_run']
        db.execute("""insert into ci_worker_runs(
            specialist_role,state,finished_at,details)
            values('discovery','completed',now(),'{"boards_scanned":0}'::jsonb)""")
        after=db.execute('select ci_specialist_pool_plan()').fetchone()[0]
        assert lane(after)['throughput_per_run']==normal
        db.rollback()
