"""Transactional Career Intelligence catalog over ci_ tables.

All writes use a trusted server-side PostgreSQL connection. No model-produced
SQL, app browser credentials, or permissions outside the ci_ namespace.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID
import re

_TRACKERS = {'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid'}


def normalize_domain(domain: str | None) -> str | None:
    if domain is None or not domain.strip():
        return None
    result = domain.strip().lower().rstrip('.')
    if result.startswith('www.'):
        result = result[4:]
    if not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', result):
        raise ValueError('invalid canonical domain')
    return result


def canonical_job_url(url: str) -> str:
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('public http(s) job URL required')
    if parsed.port not in (None, 80, 443):
        raise ValueError('nonstandard ports are not allowed')
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
             if not k.lower().startswith('utm_') and k.lower() not in _TRACKERS]
    path = parsed.path.rstrip('/') or '/'
    return urlunsplit((parsed.scheme.lower(), parsed.hostname.lower(), path, urlencode(query), ''))


class PostgresCareerCatalog:
    """Atomic company/job provenance, assessments and lifetime-delivery ledger."""

    def __init__(self, dsn: str):
        if not dsn:
            raise ValueError('DATABASE_URL required')
        self.dsn = dsn
        self.conn = None

    def __enter__(self) -> 'PostgresCareerCatalog':
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise RuntimeError('Install services/worker[agents] for PostgreSQL') from error
        self.conn = psycopg.connect(self.dsn, row_factory=dict_row)
        return self

    def __exit__(self, *_):
        if self.conn:
            self.conn.close()

    def _upsert_company(self, source: str, name: str, domain: str | None) -> UUID:
        normalized_name = ' '.join(name.casefold().split())
        if not normalized_name or not source:
            raise ValueError('source and company name required')
        key = 'domain:' + domain if domain else f'source:{source}:{normalized_name}'
        self.conn.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', ('ci-company:' + key,))
        if domain:
            found = self.conn.execute('SELECT id FROM ci_companies WHERE lower(canonical_domain)=%s', (domain,)).fetchone()
            if found:
                return found['id']
        else:
            found = self.conn.execute('''SELECT c.id FROM ci_company_aliases a JOIN ci_companies c ON c.id=a.company_id
                                        WHERE a.alias_type='source_identity' AND a.alias_value=%s''', (key,)).fetchone()
            if found:
                return found['id']
        company = self.conn.execute('''INSERT INTO ci_companies(canonical_domain,legal_name,normalized_name)
                                       VALUES (%s,%s,%s) RETURNING id''', (domain, name, normalized_name)).fetchone()['id']
        if not domain:
            self.conn.execute('''INSERT INTO ci_company_aliases(company_id,alias_type,alias_value)
                                 VALUES (%s,'source_identity',%s)''', (company, key))
        return company

    def upsert_job(self, *, source: str, source_job_id: str | None, company_name: str,
                   company_domain: str | None, title: str, apply_url: str,
                   published_at: datetime | None = None, remote_text: str | None = None) -> str:
        if not source.strip() or not title.strip() or not company_name.strip():
            raise ValueError('source, company, and title required')
        domain = normalize_domain(company_domain)
        url = canonical_job_url(apply_url)
        if published_at is not None and published_at.tzinfo is None:
            raise ValueError('published_at must include timezone')
        with self.conn.transaction():
            if source_job_id:
                found = self.conn.execute('''SELECT job_id FROM ci_job_sources
                                             WHERE source_name=%s AND source_job_id=%s''',
                                          (source, source_job_id)).fetchone()
                if found:
                    return str(found['job_id'])
            company = self._upsert_company(source, company_name, domain)
            result = self.conn.execute('''INSERT INTO ci_jobs
                (company_id,title,apply_url,canonical_apply_url,status,published_at,
                 last_verified_at,timestamp_source,timestamp_confidence,remote_text)
                VALUES (%s,%s,%s,%s,'open',%s,now(),%s,%s,%s)
                ON CONFLICT(company_id,canonical_apply_url) DO UPDATE SET
                    last_verified_at=now(),status='open',title=excluded.title,
                    remote_text=excluded.remote_text
                RETURNING id''', (company,title,apply_url,url,published_at,
                                  'source_publication' if published_at else 'unknown',
                                  'authoritative' if published_at else 'unknown',remote_text)).fetchone()
            job_id = result['id']
            if source_job_id:
                self.conn.execute('''INSERT INTO ci_job_sources(job_id,source_name,source_job_id,source_url)
                    VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
                    (job_id, source, source_job_id, apply_url))
            return str(job_id)

    def pending_eligibility(self, limit: int = 30) -> list[dict]:
        if not 1 <= limit <= 100:
            raise ValueError('eligibility limit must be 1..100')
        rows = self.conn.execute("""SELECT j.id,j.apply_url,j.title,j.remote_text
            FROM ci_jobs j WHERE j.status='open' AND NOT EXISTS
            (SELECT 1 FROM ci_eligibility_assessments e WHERE e.job_id=j.id)
            ORDER BY j.published_at DESC NULLS LAST,j.first_seen_at DESC LIMIT %s""",(limit,)).fetchall()
        return [dict(row) for row in rows]

    def assess_job(self, job_id: str, *, status: str, source_url: str | None,
                   excerpt: str, confidence: float, policy_version: str = '0.5') -> None:
        if status not in {'verified_eligible','likely_eligible','unknown','ineligible'}:
            raise ValueError('invalid eligibility status')
        if not 0 <= confidence <= 1:
            raise ValueError('confidence must be between 0 and 1')
        if status == 'verified_eligible' and (not source_url or not excerpt.strip()):
            raise ValueError('verified eligibility requires source evidence')
        if source_url:
            canonical_job_url(source_url)
        with self.conn.transaction():
            row = self.conn.execute('SELECT id,company_id FROM ci_jobs WHERE id=%s', (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            if source_url and excerpt:
                from hashlib import sha256
                self.conn.execute('''INSERT INTO ci_eligibility_evidence
                    (job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
                    VALUES (%s,%s,'source_page',%s,%s,'job',%s,%s)''',
                    (job_id,source_url,excerpt,sha256(excerpt.encode()).hexdigest(),
                     excerpt,'authoritative' if status=='verified_eligible' else 'unverified'))
            self.conn.execute('''INSERT INTO ci_eligibility_assessments
                  (job_id,status,confidence,reasons,contradictions,policy_version)
                  VALUES (%s,%s,%s,%s::jsonb,'[]'::jsonb,%s)''',
                  (job_id,status,confidence,'["'+status+'"]',policy_version))
            if status=='verified_eligible':
                self.conn.execute("""INSERT INTO ci_contact_research_tasks(company_id)
                    VALUES (%s) ON CONFLICT DO NOTHING""", (row['company_id'],))

    def create_batch(self, owner: UUID, day: date, target: int = 100) -> list[dict]:
        if not isinstance(owner, UUID) or not isinstance(day, date):
            raise ValueError('owner UUID and local date required')
        if not 1 <= target <= 100:
            raise ValueError('target must be between 1 and 100')
        with self.conn.transaction():
            # Serialize all daily batches for a particular user to preserve the
            # lifetime promise when multiple scheduled workers overlap.
            self.conn.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', ('ci-delivery:'+str(owner),))
            batch = self.conn.execute('''INSERT INTO ci_daily_batches(owner_user_id,local_date,target)
                VALUES (%s,%s,%s) ON CONFLICT(owner_user_id,local_date) DO UPDATE SET
                generated_at=ci_daily_batches.generated_at RETURNING id''', (owner, day, target)).fetchone()['id']
            existing = self.conn.execute('''SELECT i.job_id,i.company_id,i.rank FROM ci_daily_batch_items i
                WHERE i.batch_id=%s ORDER BY rank''', (batch,)).fetchall()
            remaining = max(0, target-len(existing))
            if remaining:
                candidates = self.conn.execute('''SELECT j.id AS job_id,j.company_id,
                      COALESCE(m.score,0) AS score,j.published_at
                   FROM ci_jobs j
                   JOIN LATERAL (SELECT a.status,a.expires_at FROM ci_eligibility_assessments a
                       WHERE a.job_id=j.id ORDER BY a.assessed_at DESC,a.id DESC LIMIT 1) a ON TRUE
                   LEFT JOIN LATERAL (SELECT score FROM ci_job_matches m
                       WHERE m.job_id=j.id ORDER BY computed_at DESC LIMIT 1) m ON TRUE
                   WHERE j.status='open' AND a.status='verified_eligible'
                     AND j.published_at>=now()-interval '7 days'
                     AND (a.expires_at IS NULL OR a.expires_at>now())
                     AND EXISTS (SELECT 1 FROM ci_eligibility_evidence ev WHERE ev.job_id=j.id)
                     AND NOT EXISTS (SELECT 1 FROM ci_delivered_companies dc
                                     WHERE dc.owner_user_id=%s AND dc.company_id=j.company_id)
                     AND NOT EXISTS (SELECT 1 FROM ci_delivered_jobs dj
                                     WHERE dj.owner_user_id=%s AND dj.job_id=j.id)
                   ORDER BY (j.published_at>=now()-interval '72 hours') DESC,
                            score DESC,j.published_at DESC NULLS LAST,j.first_seen_at DESC
                   LIMIT %s''', (owner,owner,max(remaining*8,remaining))).fetchall()
                taken = {x['company_id'] for x in existing}
                rank = len(existing)
                for candidate in candidates:
                    if rank >= target:
                        break
                    cid, jid = candidate['company_id'], candidate['job_id']
                    if cid in taken:
                        continue
                    did = self.conn.execute('''INSERT INTO ci_delivered_companies(owner_user_id,company_id,first_batch_id)
                        VALUES (%s,%s,%s) ON CONFLICT DO NOTHING RETURNING company_id''',(owner,cid,batch)).fetchone()
                    if not did:
                        continue
                    self.conn.execute('''INSERT INTO ci_delivered_jobs(owner_user_id,job_id)
                                         VALUES (%s,%s) ON CONFLICT DO NOTHING''',(owner,jid))
                    rank += 1
                    self.conn.execute('''INSERT INTO ci_daily_batch_items(batch_id,company_id,job_id,rank)
                                         VALUES (%s,%s,%s,%s)''',(batch,cid,jid,rank))
                    taken.add(cid)
            results = self.conn.execute('''SELECT job_id,company_id,rank FROM ci_daily_batch_items
                                           WHERE batch_id=%s ORDER BY rank''',(batch,)).fetchall()
            return [{'job_id':str(row['job_id']),'company_id':str(row['company_id']),
                     'rank':row['rank']} for row in results]

    def list_batch(self, owner: UUID, day: date) -> list[dict]:
        rows=self.conn.execute("""SELECT i.job_id,i.company_id,i.rank,j.title,j.apply_url,
             j.published_at,c.legal_name AS company_name
             FROM ci_daily_batches b JOIN ci_daily_batch_items i ON i.batch_id=b.id
             JOIN ci_jobs j ON j.id=i.job_id JOIN ci_companies c ON c.id=i.company_id
             WHERE b.owner_user_id=%s AND b.local_date=%s ORDER BY i.rank""",(owner,day)).fetchall()
        return [{**dict(row),'job_id':str(row['job_id']),
                 'company_id':str(row['company_id'])} for row in rows]

    def metrics(self, owner: UUID) -> dict:
        counts=self.conn.execute("""SELECT
          (SELECT count(*) FROM ci_companies) AS companies,
          (SELECT count(*) FROM ci_jobs) AS jobs,
          (SELECT count(*) FROM ci_delivered_companies WHERE owner_user_id=%s) AS delivered,
          (SELECT count(*) FROM ci_applications WHERE owner_user_id=%s) AS applications""",(owner,owner)).fetchone()
        return dict(counts)

    def pending_people(self, limit: int = 10) -> list[dict]:
        if not 1<=limit<=20:
            raise ValueError('people research limit must be 1..20')
        rows=self.conn.execute("""SELECT t.id,t.company_id,c.canonical_domain
          FROM ci_contact_research_tasks t JOIN ci_companies c ON c.id=t.company_id
          WHERE t.state='pending' ORDER BY t.created_at LIMIT %s""",(limit,)).fetchall()
        return [dict(row) for row in rows]

    def resolve_people_task(self,task_id,state:str)->None:
        if state not in ('completed','blocked'):
            raise ValueError('invalid research state')
        with self.conn.transaction():
            row=self.conn.execute("""UPDATE ci_contact_research_tasks SET state=%s
                      WHERE id=%s AND state='pending' RETURNING id""",(state,task_id)).fetchone()
            if not row:
                raise KeyError(task_id)

    def add_contact(self,company_id,contact:dict)->str:
        url=canonical_job_url(contact['profile_url'])
        source=canonical_job_url(contact['source'])
        with self.conn.transaction():
            row=self.conn.execute("""INSERT INTO ci_contacts
                 (company_id,name,current_title,profile_url,profile_source_url)
                 VALUES (%s,%s,%s,%s,%s)
                 ON CONFLICT(company_id,profile_url) DO UPDATE SET
                   current_title=excluded.current_title RETURNING id""",
                 (company_id,contact['name'],contact['title'],url,source)).fetchone()
            return str(row['id'])

    def list_jobs(self, limit: int = 100) -> list[dict]:
        if not 1<=limit<=500:raise ValueError('limit must be 1..500')
        rows=self.conn.execute("""SELECT j.id,j.title,j.apply_url,j.status,
          j.published_at,j.first_seen_at,c.id AS company_id,c.legal_name AS company_name,
          a.status AS eligibility,COALESCE(m.score,0) AS match_score
          FROM ci_jobs j JOIN ci_companies c ON c.id=j.company_id
          LEFT JOIN LATERAL (SELECT status FROM ci_eligibility_assessments a
             WHERE a.job_id=j.id ORDER BY assessed_at DESC,id DESC LIMIT 1) a ON true
          LEFT JOIN LATERAL (SELECT score FROM ci_job_matches m
             WHERE m.job_id=j.id ORDER BY computed_at DESC LIMIT 1) m ON true
          ORDER BY j.published_at DESC NULLS LAST,j.first_seen_at DESC LIMIT %s""",(limit,)).fetchall()
        return [{**dict(x),'id':str(x['id']),'company_id':str(x['company_id'])} for x in rows]

    def list_contacts(self, limit: int = 100) -> list[dict]:
        if not 1<=limit<=500:raise ValueError('limit must be 1..500')
        rows=self.conn.execute("""SELECT p.id,p.name,p.current_title,p.profile_url,
          p.identity_verified,c.legal_name AS company_name
          FROM ci_contacts p JOIN ci_companies c ON c.id=p.company_id
          ORDER BY p.created_at DESC LIMIT %s""",(limit,)).fetchall()
        return [{**dict(x),'id':str(x['id'])} for x in rows]

    def list_knowledge_index(self) -> list[dict]:
        rows=self.conn.execute("""SELECT path,visibility,git_sha,content_sha,updated_at
          FROM ci_knowledge_documents WHERE status='approved' ORDER BY path""").fetchall()
        return [dict(x) for x in rows]

    def list_applications(self, owner: UUID) -> list[dict]:
        rows=self.conn.execute("""SELECT a.id,a.job_id,a.status,a.applied_at,a.notes,
          j.title,c.legal_name AS company_name,j.apply_url
          FROM ci_applications a JOIN ci_jobs j ON j.id=a.job_id
          JOIN ci_companies c ON c.id=a.company_id
          WHERE a.owner_user_id=%s ORDER BY a.applied_at DESC NULLS LAST""",(owner,)).fetchall()
        return [{**dict(x),'id':str(x['id']),'job_id':str(x['job_id'])} for x in rows]

    def list_outreach(self,owner:UUID) -> list[dict]:
        rows=self.conn.execute("""SELECT o.id,o.job_id,o.contact_id,o.subject,o.body,o.status,o.created_at
          FROM ci_outreach_drafts o WHERE o.owner_user_id=%s
          ORDER BY o.created_at DESC LIMIT 100""",(owner,)).fetchall()
        return [{**dict(x),'id':str(x['id']),'job_id':str(x['job_id']),
                  'contact_id':str(x['contact_id'])} for x in rows]

    def operations(self) -> dict:
        rows=self.conn.execute('SELECT state,count(*) as total FROM ci_workflow_tasks GROUP BY state').fetchall()
        return {r['state']:r['total'] for r in rows}

    def record_application(self,owner:UUID,job_id:str,status:str,notes:str='')->str:
        if status not in {'discovered','saved','applied','interviewing','offer','rejected','withdrawn'}:
            raise ValueError('invalid application status')
        if len(notes)>1000:raise ValueError('notes too long')
        with self.conn.transaction():
            job=self.conn.execute('SELECT company_id FROM ci_jobs WHERE id=%s',(job_id,)).fetchone()
            if not job:raise KeyError(job_id)
            record=self.conn.execute("""INSERT INTO ci_applications
                (owner_user_id,company_id,job_id,status,notes,applied_at)
                VALUES (%s,%s,%s,%s,%s,CASE WHEN %s='applied' THEN now() ELSE null END)
                ON CONFLICT(owner_user_id,job_id) DO UPDATE SET
                   status=excluded.status,notes=excluded.notes,
                   applied_at=COALESCE(ci_applications.applied_at,excluded.applied_at)
                RETURNING id""",(owner,job['company_id'],job_id,status,notes,status)).fetchone()
            self.conn.execute("""INSERT INTO ci_application_events(application_id,event_type,details)
                VALUES (%s,%s,'{}'::jsonb)""",(record['id'],status))
            return str(record['id'])
