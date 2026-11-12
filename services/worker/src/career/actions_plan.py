"""Pure, quota-bounded GitHub Actions matrix planning from existing specialist telemetry.

Do not infer that a number of queued raw leads equals verified eligible suitable
jobs. This only schedules authenticated specialist invocations.
"""
from __future__ import annotations
import argparse
import json
import os
from career.graph import AGENT_ROLES

ROLE_SET=frozenset(AGENT_ROLES)

def make_matrix(plan:dict,*,max_jobs:int=12)->dict:
    """Build a deterministic matrix of separate ephemeral specialist processes.

    The live SQL planner already accounts for active Edge work, source cooldowns,
    observed throughput and shared budgets. This extra bounded layer protects
    the free GitHub runner quota from unexpected fanout.
    """
    if not 1<=max_jobs<=48:
        raise ValueError('CI_ACTIONS_MAX_JOBS must be between 1 and 48')
    if not isinstance(plan,dict) or not isinstance(plan.get('roles'),list):
        raise ValueError('expected specialist plan with roles array')
    if not plan.get('enabled',False):
        return {'include':[]}
    capacity=min(max_jobs,int(plan.get('dispatch_budget',max_jobs)))
    available=max(0,int(plan.get('active_budget',max_jobs))-int(plan.get('active_total',0)))
    capacity=min(capacity,available)
    matrix=[]
    observed=set()
    for role in plan['roles']:
        if not isinstance(role,dict):
            raise ValueError('invalid specialist lane')
        name=role.get('role')
        if name not in ROLE_SET or name in observed:
            raise ValueError('unknown or repeated specialist')
        observed.add(name)
        requested=int(role.get('spawn',0))
        ready=int(role.get('queued',0))
        if requested<0 or ready<0:
            raise ValueError('negative stage capacity')
        to_start=min(requested,ready,max(0,capacity-len(matrix)))
        for shard in range(to_start):
            matrix.append({'role':name,'shard':shard})
        if len(matrix)>=capacity:
            break
    return {'include':matrix}

def read_plan(database_url:str)->dict:
    if not database_url:
        raise ValueError('DATABASE_URL required')
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(database_url,row_factory=dict_row,connect_timeout=12) as conn:
        result=conn.execute('select public.ci_specialist_pool_plan() as plan').fetchone()
        return result['plan']

def main(argv:list[str]|None=None)->int:
    parser=argparse.ArgumentParser(description='GitHub Actions specialist workload planner')
    parser.add_argument('--max-jobs',type=int,default=int(os.getenv('CI_ACTIONS_MAX_JOBS','12')))
    parser.add_argument('--offline-plan',help='Local test JSON (never used in production workflow)')
    args=parser.parse_args(argv)
    if args.offline_plan:
        with open(args.offline_plan,encoding='utf8') as f:
            plan=json.load(f)
    else:
        plan=read_plan(os.getenv('DATABASE_URL',''))
    matrix=make_matrix(plan,max_jobs=args.max_jobs)
    output=json.dumps(matrix,separators=(',',':'))
    # Only bounded role names and integers appear in output, never credentials.
    print(output)
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf8') as f:
            f.write('matrix='+output+'\n')
            f.write('count='+str(len(matrix['include']))+'\n')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
