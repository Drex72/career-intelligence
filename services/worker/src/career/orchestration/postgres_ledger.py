"""Transactional PostgreSQL ledger for short-lived agent workers.

Requires psycopg3 and application migrations. Uses SKIP LOCKED claims and
idempotency keys; never exposes arbitrary SQL from agent outputs.
"""
from __future__ import annotations
import json
from uuid import UUID

class PostgresTaskLedger:
    def __init__(self,dsn:str):
        if not dsn:raise ValueError('DATABASE_URL is required')
        self.dsn=dsn;self.conn=None

    def __enter__(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as e:
            raise RuntimeError('Install the [agents] worker extra for PostgreSQL') from e
        self.conn=psycopg.connect(self.dsn,row_factory=dict_row)
        return self

    def __exit__(self,*_):
        if self.conn:self.conn.close()

    def enqueue(self,kind:str,key:str,payload:dict,max_attempts:int=3)->str:
        if not kind or not key or not 1<=max_attempts<=10:raise ValueError('invalid task arguments')
        with self.conn.transaction():
            wf=self.conn.execute('''INSERT INTO ci_workflows(kind,status,version,correlation_key) VALUES(%s,'pending','0.5',%s)
              ON CONFLICT(correlation_key) DO UPDATE SET updated_at=ci_workflows.updated_at RETURNING id''',(kind,key)).fetchone()['id']
            task=self.conn.execute('''INSERT INTO ci_workflow_tasks(workflow_id,task_type,input_ref,idempotency_key,max_attempts)
              VALUES(%s,%s,%s,%s,%s) ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=ci_workflow_tasks.updated_at RETURNING id''',
              (wf,kind,json.dumps(payload),key,max_attempts)).fetchone()['id']
            return str(task)

    def claim(self,worker:str,lease_seconds:int=120)->dict|None:
        if not worker or not 1<=lease_seconds<=3600:raise ValueError('invalid worker lease')
        with self.conn.transaction():
            # A crashed worker on its final attempt must not leave a permanent
            # 'running' record that no subsequent worker can claim.
            exhausted=self.conn.execute('''UPDATE ci_workflow_tasks
                 SET state='failed',worker_id=NULL,lease_until=NULL,updated_at=now()
                 WHERE state='running' AND lease_until<=now()
                   AND attempt_count>=max_attempts RETURNING id''').fetchall()
            for expired in exhausted:
                self.conn.execute('''INSERT INTO ci_task_events(task_id,event_type,payload)
                     VALUES(%s,'failed',%s)''',(expired['id'],json.dumps({'error_code':'expired_final_lease'})))
            row=self.conn.execute('''WITH candidate AS (
                SELECT t.id FROM ci_workflow_tasks t
                WHERE (t.state='pending' OR (t.state='retry_wait' AND t.next_retry_at<=now())
                       OR (t.state='running' AND t.lease_until<=now()))
                  AND t.attempt_count < t.max_attempts
                  AND NOT EXISTS (
                    SELECT 1 FROM ci_task_dependencies d JOIN ci_workflow_tasks predecessor ON predecessor.id=d.predecessor_id
                     WHERE d.task_id=t.id AND predecessor.state<>'completed')
                ORDER BY t.priority DESC,t.created_at ASC
                FOR UPDATE SKIP LOCKED LIMIT 1)
                UPDATE ci_workflow_tasks t SET state='running',worker_id=%s,
                  lease_until=now()+(%s * interval '1 second'),attempt_count=t.attempt_count+1,
                  updated_at=now() FROM candidate c WHERE t.id=c.id
                RETURNING t.id,t.workflow_id,t.task_type,t.input_ref,t.attempt_count''',(worker,lease_seconds)).fetchone()
            if row:
                self.conn.execute('INSERT INTO ci_task_events(task_id,event_type,payload) VALUES(%s,%s,%s)',(row['id'],'claimed',json.dumps({'worker':worker})))
                return {**row,'id':str(row['id']),'workflow_id':str(row['workflow_id'])}
            return None

    def heartbeat(self,task_id:str,worker:str,lease_seconds:int=120)->bool:
        with self.conn.transaction():
            row=self.conn.execute('''UPDATE ci_workflow_tasks SET lease_until=now()+(%s * interval '1 second')
              WHERE id=%s AND worker_id=%s AND state='running' RETURNING id''',(lease_seconds,task_id,worker)).fetchone()
            return bool(row)

    def complete(self,task_id:str,worker:str,result:dict)->None:
        with self.conn.transaction():
            row=self.conn.execute('''UPDATE ci_workflow_tasks SET state='completed',output_ref=%s,worker_id=NULL,lease_until=NULL,updated_at=now()
                WHERE id=%s AND worker_id=%s AND state='running' RETURNING id''',(json.dumps(result),task_id,worker)).fetchone()
            if not row:
                old=self.conn.execute('SELECT state,output_ref FROM ci_workflow_tasks WHERE id=%s',(task_id,)).fetchone()
                if old and old['state']=='completed' and old['output_ref']==json.dumps(result):return
                raise PermissionError('task not claimed by worker')
            self.conn.execute('INSERT INTO ci_task_events(task_id,event_type,payload) VALUES(%s,%s,%s)',(task_id,'completed',json.dumps({})))

    def fail(self,task_id:str,worker:str,error_code:str)->str:
        with self.conn.transaction():
            r=self.conn.execute('''SELECT attempt_count,max_attempts FROM ci_workflow_tasks WHERE id=%s AND worker_id=%s AND state='running' FOR UPDATE''',(task_id,worker)).fetchone()
            if not r:raise PermissionError('task not claimed by worker')
            exhausted=r['attempt_count']>=r['max_attempts']
            state='failed' if exhausted else 'retry_wait'
            seconds=min(2**r['attempt_count'],3600)
            self.conn.execute('''UPDATE ci_workflow_tasks SET state=%s,worker_id=NULL,lease_until=NULL,
                 next_retry_at=CASE WHEN %s THEN NULL ELSE now()+(%s*interval '1 second') END,
                 updated_at=now() WHERE id=%s''',(state,exhausted,seconds,task_id))
            self.conn.execute('INSERT INTO ci_task_events(task_id,event_type,payload) VALUES(%s,%s,%s)',(task_id,state,json.dumps({'error_code':error_code[:80]})))
            return state

    def task(self,task_id:str)->dict|None:
        row=self.conn.execute('SELECT * FROM ci_workflow_tasks WHERE id=%s',(task_id,)).fetchone()
        return dict(row) if row else None
