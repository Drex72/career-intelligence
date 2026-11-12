"""Demand-driven Github Actions worker fanout and safe release gates."""
from __future__ import annotations
import pytest
from unittest.mock import Mock
from pathlib import Path
from career.actions_plan import make_matrix
from career.graph import AGENT_ROLES
from career.hosted_langgraph import require_no_parallel_scheduler

def sample_plan(spawns=(4,3,2,1,0,0),enabled=True):
    roles=('eligibility','matching','discovery','people','outreach','conversation')
    return {'enabled':enabled,'active_budget':32,'active_total':0,'dispatch_budget':24,
            'roles':[{'role':role,'spawn':spawn,'queued':100} for role,spawn in zip(roles,spawns)]}

def test_matrix_uses_real_role_spawns_and_is_demand_bounded():
    mat=make_matrix(sample_plan(),max_jobs=6)['include']
    assert len(mat)==6
    assert [x['role'] for x in mat]==['eligibility']*4+['matching']*2
    assert all(isinstance(x['shard'],int) for x in mat)

def test_matrix_ignores_empty_lanes_and_clamps_to_eligible_tasks():
    plan=sample_plan((3,1,1,1,1,1))
    plan['roles'][0]['queued']=1
    mat=make_matrix(plan,max_jobs=12)['include']
    assert sum(x['role']=='eligibility' for x in mat)==1
    assert len(mat)==6

def test_matrix_refuses_work_when_pool_disabled():
    assert make_matrix(sample_plan(enabled=False))=={'include':[]}

def test_matrix_refuses_unknown_role_duplicate_or_negative_demand():
    for mutate in (
        lambda p: p['roles'][0].update(role='email_sender'),
        lambda p: p['roles'][1].update(role='eligibility'),
        lambda p: p['roles'][0].update(spawn=-2),
        lambda p: p['roles'][0].update(queued=-1),
    ):
        p=sample_plan()
        mutate(p)
        with pytest.raises(ValueError):
            make_matrix(p)

@pytest.mark.parametrize('count',[0,49,100])
def test_matrix_refuses_invalid_budget(count):
    with pytest.raises(ValueError):
        make_matrix(sample_plan(),max_jobs=count)

def test_actions_workflow_is_manual_and_schedulable_but_not_a_pull_request_dispatcher():
    text=Path('.github/workflows/ci-langgraph-workers.yml').read_text()
    assert 'workflow_dispatch:' in text and 'schedule:' in text
    assert 'pull_request_target:' not in text
    assert 'CI_GITHUB_ACTIONS_LIVE' in text
    assert 'CI_REQUIRE_CRON_DISABLED' in text
    assert '--once' in text and '--dry-run' in text
    assert 'secrets.CI_ACTIONS_DATABASE_URL' in text
    assert 'secrets.CI_ACTIONS_WORKER_SIGNING_KEY' in text
    assert "cancel-in-progress: false" in text

def test_refuse_live_dispatch_when_existing_supabase_scheduler_active():
    conn=Mock()
    conn.execute.return_value.fetchone.side_effect=[
        {'present':'cron.job'}, {'n':1}]
    with pytest.raises(RuntimeError,match='Old Supabase'):
        require_no_parallel_scheduler(conn)

def test_refuse_live_dispatch_when_cron_visibility_unavailable():
    conn=Mock()
    conn.execute.return_value.fetchone.return_value={'present':None}
    with pytest.raises(RuntimeError,match='Cannot verify'):
        require_no_parallel_scheduler(conn)

def test_allow_live_only_after_no_old_scheduler_remains():
    conn=Mock()
    conn.execute.return_value.fetchone.side_effect=[
        {'present':'cron.job'},{'n':0}]
    require_no_parallel_scheduler(conn)
