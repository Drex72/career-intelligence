"""SQLite development harness for Gas Town-style leased execution.

Production plan uses PostgreSQL FOR UPDATE SKIP LOCKED; this is a local
contract testing mode, not a replacement for the cloud task ledger.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
from uuid import UUID, uuid4


@dataclass(frozen=True)
class Claimed:
    id: UUID
    workflow_id: UUID
    task_type: str
    input_ref: str
    attempt: int


class LocalTaskLedger:
    def __init__(self, path: Path | str):
        self.db=sqlite3.connect(str(path),timeout=10)
        self.db.execute('PRAGMA busy_timeout=10000')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS tasks(
              id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, task_type TEXT NOT NULL,
              input_ref TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
              state TEXT NOT NULL DEFAULT 'pending', worker TEXT, lease_until TEXT,
              attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
              retry_at TEXT, output_ref TEXT);
            CREATE TABLE IF NOT EXISTS deps(task_id TEXT NOT NULL, predecessor TEXT NOT NULL,
              PRIMARY KEY(task_id,predecessor), FOREIGN KEY(task_id) REFERENCES tasks(id));
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,
              task_id TEXT NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL);
        ''')

    def __enter__(self): return self
    def __exit__(self, *_): self.db.close()

    def enqueue(self, workflow_id: UUID, task_type: str, input_ref: str, idempotency_key: str,
                depends_on: list[UUID] | None = None, max_attempts: int = 3) -> UUID:
        if not idempotency_key or max_attempts < 1:
            raise ValueError('valid task key and bounded attempts required')
        id_=str(uuid4())
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO tasks(id,workflow_id,task_type,input_ref,idempotency_key,max_attempts) VALUES(?,?,?,?,?,?)',
                            (id_,str(workflow_id),task_type,input_ref,idempotency_key,max_attempts))
            row=self.db.execute('SELECT id FROM tasks WHERE idempotency_key=?',(idempotency_key,)).fetchone()
            task_id=row[0]
            for d in depends_on or []:
                self.db.execute('INSERT OR IGNORE INTO deps(task_id,predecessor) VALUES (?,?)',(task_id,str(d)))
        return UUID(task_id)

    def claim(self, worker: str, now: datetime, lease_seconds: int) -> Claimed | None:
        if not worker or lease_seconds < 1:
            raise ValueError('worker and positive lease required')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            row=self.db.execute('''
              SELECT id,workflow_id,task_type,input_ref,attempts FROM tasks t
              WHERE (state='pending'
                 OR (state='retry_wait' AND retry_at<=?)
                 OR (state='running' AND lease_until<=?))
              AND NOT EXISTS (SELECT 1 FROM deps d JOIN tasks p ON p.id=d.predecessor
                              WHERE d.task_id=t.id AND p.state<>'completed')
              ORDER BY rowid LIMIT 1''',(now.isoformat(),now.isoformat())).fetchone()
            if row is None:
                self.db.commit()
                return None
            task_id,wf,typ,ref,tries=row
            self.db.execute('UPDATE tasks SET state=?,worker=?,lease_until=?,attempts=attempts+1 WHERE id=?',
                            ('running',worker,(now+timedelta(seconds=lease_seconds)).isoformat(),task_id))
            self._event(task_id,'claimed',now)
            self.db.commit()
            return Claimed(UUID(task_id),UUID(wf),typ,ref,tries+1)
        except Exception:
            self.db.rollback();raise

    def _event(self, task_id: str, kind: str, now: datetime):
        self.db.execute('INSERT INTO events(task_id,event,created_at) VALUES (?,?,?)',(task_id,kind,now.isoformat()))

    def complete(self, task_id: UUID, output_ref: str, worker: str, now: datetime):
        with self.db:
            row=self.db.execute('SELECT state,worker,output_ref FROM tasks WHERE id=?',(str(task_id),)).fetchone()
            if row is None: raise KeyError(task_id)
            if row[0]=='completed':
                if row[2] != output_ref: raise ValueError('completed task output immutable')
                return
            if row[0]!='running' or row[1]!=worker: raise PermissionError('not task owner')
            self.db.execute('UPDATE tasks SET state=?,output_ref=?,worker=NULL,lease_until=NULL WHERE id=?',
                            ('completed',output_ref,str(task_id)))
            self._event(str(task_id),'completed',now)

    def fail(self, task_id: UUID, code: str, worker: str, now: datetime):
        with self.db:
            row=self.db.execute('SELECT state,worker,attempts,max_attempts FROM tasks WHERE id=?',(str(task_id),)).fetchone()
            if row is None: raise KeyError(task_id)
            if row[0]!='running' or row[1]!=worker: raise PermissionError('not task owner')
            state='failed' if row[2]>=row[3] else 'retry_wait'
            retry=(now+timedelta(seconds=min(2**row[2],3600))).isoformat() if state=='retry_wait' else None
            self.db.execute('UPDATE tasks SET state=?,worker=NULL,lease_until=NULL,retry_at=? WHERE id=?',(state,retry,str(task_id)))
            self._event(str(task_id),state,now)

    def state(self, task_id: UUID) -> str:
        return self.db.execute('SELECT state FROM tasks WHERE id=?',(str(task_id),)).fetchone()[0]

    def attempts(self, task_id: UUID) -> int:
        return self.db.execute('SELECT attempts FROM tasks WHERE id=?',(str(task_id),)).fetchone()[0]

    def events(self, task_id: UUID) -> list[str]:
        return [r[0] for r in self.db.execute('SELECT event FROM events WHERE task_id=? ORDER BY id',(str(task_id),))]
