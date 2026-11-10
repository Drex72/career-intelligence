"""SQLite development-only delivery ledger. Production uses Postgres transactional ledger.

Useful for offline demos and testing deduplication across separate invocations.
"""
from pathlib import Path
import sqlite3
from uuid import UUID
from career.discovery.batches import ProposedJob, select_daily_batch
from datetime import datetime, timezone


class LocalBatchStore:
    def __init__(self, path: Path | str):
        self.conn = sqlite3.connect(str(path), timeout=10.0)
        self.conn.execute('PRAGMA busy_timeout=10000')
        self.conn.executescript('''
            CREATE TABLE IF NOT EXISTS delivered_company(
              owner TEXT NOT NULL, company TEXT NOT NULL, job TEXT NOT NULL,
              delivered_date TEXT NOT NULL, PRIMARY KEY(owner,company));
            CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_job ON delivered_company(owner,job);
        ''')

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.conn.close()

    def deliver(self, owner: str, local_date: str, jobs: list[ProposedJob]) -> list[UUID]:
        if not owner:
            raise ValueError('owner required')
        self.conn.execute('BEGIN IMMEDIATE')
        try:
            existing = self.conn.execute('SELECT company,job FROM delivered_company WHERE owner=?', (owner,)).fetchall()
            selected = select_daily_batch(jobs, {UUID(x) for x,_ in existing},
                                          {UUID(y) for _,y in existing}, datetime.now(timezone.utc))
            ids=[]
            for item in selected:
                self.conn.execute('INSERT INTO delivered_company(owner,company,job,delivered_date) VALUES (?,?,?,?)',
                                  (owner,str(item.company_id),str(item.job_id),local_date))
                ids.append(item.job_id)
            self.conn.commit()
            return ids
        except Exception:
            self.conn.rollback()
            raise

    def history(self, owner: str) -> list[tuple[str,str,str]]:
        return self.conn.execute('SELECT company,job,delivered_date FROM delivered_company WHERE owner=? ORDER BY delivered_date,company', (owner,)).fetchall()
