"""Single-user development runtime implementing end-to-end workflow semantics.

SQLite is for local operation; PostgreSQL migrations define intended cloud schema.
No outbound email is sent from this module.
"""
from __future__ import annotations
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4
import json
import sqlite3
from career.knowledge.vault import parse_note
from career.eligibility.rules import assess_text

SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS boards(id INTEGER PRIMARY KEY, provider TEXT NOT NULL, slug TEXT NOT NULL, company_name TEXT NOT NULL, domain TEXT, active INTEGER NOT NULL DEFAULT 1, UNIQUE(provider,slug));
CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT UNIQUE, identity_key TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), source TEXT NOT NULL, source_job_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL, apply_url TEXT NOT NULL, remote_text TEXT, published_at TEXT, first_seen_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', eligibility TEXT NOT NULL DEFAULT 'unknown', eligibility_reason TEXT NOT NULL DEFAULT '', eligibility_evidence_url TEXT, score INTEGER NOT NULL DEFAULT 0, UNIQUE(source,source_job_id));
CREATE TABLE IF NOT EXISTS batches(owner TEXT NOT NULL, day TEXT NOT NULL, company_id TEXT NOT NULL, job_id TEXT NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY(owner,company_id), UNIQUE(owner,job_id));
CREATE TABLE IF NOT EXISTS applications(owner TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), status TEXT NOT NULL, applied_at TEXT, notes TEXT NOT NULL DEFAULT '', PRIMARY KEY(owner,job_id));
CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, title TEXT NOT NULL, profile_url TEXT NOT NULL, email TEXT, email_verified INTEGER NOT NULL DEFAULT 0, UNIQUE(company_id,profile_url));
CREATE TABLE IF NOT EXISTS outreach(id TEXT PRIMARY KEY, owner TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), contact_id TEXT NOT NULL REFERENCES contacts(id), subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', auth_mode TEXT, approved_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auto_policies(owner TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, daily_limit INTEGER NOT NULL DEFAULT 10, company_limit INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS suppression(email TEXT PRIMARY KEY, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge(path TEXT PRIMARY KEY, sha TEXT NOT NULL, body TEXT NOT NULL, visibility TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_events(id INTEGER PRIMARY KEY, path TEXT NOT NULL, action TEXT NOT NULL, sha TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intel(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT, claim TEXT NOT NULL, source_url TEXT NOT NULL, confidence TEXT NOT NULL, observed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_queue(id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, UNIQUE(kind,subject_id));
CREATE TABLE IF NOT EXISTS inbox_seen(owner TEXT NOT NULL, provider_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner,provider_id));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, event_type TEXT NOT NULL, subject_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL);
'''


def _now(): return datetime.now(timezone.utc).isoformat()
def _id(): return str(uuid4())
def _rows(cursor): return [dict(r) for r in cursor.fetchall()]
def _url(u: str) -> str:
    p=urlsplit(u.strip())
    if p.scheme not in ('http','https') or not p.hostname: raise ValueError('public http(s) URL required')
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path.rstrip('/') or '/', p.query, ''))


class CareerPlatform:
    def __init__(self, database: str | Path):
        self.db=sqlite3.connect(str(database),timeout=30, isolation_level=None)
        self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA busy_timeout=30000')
        self.db.executescript(SCHEMA)

    def __enter__(self): return self
    def __exit__(self,*_): self.db.close()

    def _event(self, typ, subject, payload=None):
        self.db.execute('INSERT INTO events(event_type,subject_id,payload,created_at) VALUES(?,?,?,?)',(typ,subject,json.dumps(payload or {}),_now()))

    def add_board(self,provider,slug,company_name,domain=None):
        if provider not in ('lever','greenhouse','ashby'): raise ValueError('unsupported ATS')
        if not slug or '/' in slug or '.' in slug or len(slug)>100: raise ValueError('invalid ATS slug')
        self.db.execute('INSERT OR IGNORE INTO boards(provider,slug,company_name,domain) VALUES(?,?,?,?)',(provider,slug,company_name,domain))

    def boards(self): return _rows(self.db.execute('SELECT * FROM boards WHERE active=1 ORDER BY id'))

    def record_job(self,*,source,source_job_id,company_name,company_domain,title,description,apply_url,remote_text,published_at,now=None):
        now=now or datetime.now(timezone.utc)
        url=_url(apply_url)
        company_domain=(company_domain or '').strip().lower() or None
        if not title.strip() or not company_name.strip(): raise ValueError('company and job title required')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            identity_key=(company_domain or f'{source}:{company_name.casefold().strip()}')
            company=self.db.execute('SELECT id FROM companies WHERE identity_key=?',(identity_key,)).fetchone()
            if company is None:
                cid=_id()
                self.db.execute('INSERT INTO companies(id,name,domain,identity_key,created_at) VALUES(?,?,?,?,?)',(cid,company_name,company_domain,identity_key,now.isoformat()))
            else: cid=company['id']
            existing=self.db.execute('SELECT id FROM jobs WHERE source=? AND source_job_id=?',(source,source_job_id)).fetchone() if source_job_id else None
            if existing:
                jid=existing['id']
            else:
                row=self.db.execute('SELECT id FROM jobs WHERE company_id=? AND apply_url=?',(cid,url)).fetchone()
                if row: jid=row['id']
                else:
                    jid=_id()
                    screen=assess_text(' '.join((description,remote_text or '')))
                    eligibility='ineligible' if screen.status=='ineligible' else 'unknown'
                    score=min(100,20+10*sum(w in (title+' '+description).lower() for w in ('python','backend','infrastructure','distributed','engineer','ai')))
                    self.db.execute('INSERT INTO jobs(id,company_id,source,source_job_id,title,description,apply_url,remote_text,published_at,first_seen_at,eligibility,eligibility_reason,score) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                                    (jid,cid,source,source_job_id,title,description,url,remote_text,published_at,now.isoformat(),eligibility,screen.reason,score))
                    self._event('job_discovered',jid,{'source':source})
                    self.db.execute('INSERT OR IGNORE INTO research_queue(id,kind,subject_id,created_at) VALUES(?,?,?,?)',(_id(),'eligibility',jid,_now()))
            self.db.commit();return jid
        except Exception:
            self.db.rollback();raise

    def get_job(self,jid):
        r=self.db.execute('SELECT j.*,c.name company_name,c.domain company_domain FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.id=?',(jid,)).fetchone()
        if r is None: raise KeyError(jid)
        return dict(r)

    def jobs(self,limit=500,eligibility=None):
        q='SELECT j.*,c.name company_name,c.domain company_domain FROM jobs j JOIN companies c ON c.id=j.company_id'
        params=[]
        if eligibility: q+=' WHERE j.eligibility=?'; params.append(eligibility)
        q+=' ORDER BY j.first_seen_at DESC LIMIT ?';params.append(min(1000,max(1,limit)))
        return _rows(self.db.execute(q,params))

    def set_eligibility(self,jid,status,reason,source_url,now=None):
        if status not in ('verified_eligible','likely_eligible','unknown','ineligible'): raise ValueError('bad eligibility')
        if status=='verified_eligible' and (not reason or not source_url): raise ValueError('verified requires evidence')
        if source_url: _url(source_url)
        self.db.execute('UPDATE jobs SET eligibility=?,eligibility_reason=?,eligibility_evidence_url=? WHERE id=?',(status,reason,source_url,jid))
        if self.db.execute('SELECT changes()').fetchone()[0]==0: raise KeyError(jid)
        self._event('eligibility_updated',jid,{'status':status,'source':source_url})
        self.db.execute("UPDATE research_queue SET status='completed' WHERE kind='eligibility' AND subject_id=?",(jid,))
        if status=='verified_eligible':
            company_id=self.get_job(jid)['company_id']
            self.db.execute('INSERT OR IGNORE INTO research_queue(id,kind,subject_id,created_at) VALUES(?,?,?,?)',(_id(),'people',company_id,_now()))

    def generate_batch(self,owner,day,target=100):
        if not owner or not 1<=target<=100: raise ValueError('bad owner or target')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            existing=self.daily_batch(owner,day)
            if existing:
                self.db.commit();return existing
            rows=_rows(self.db.execute('''SELECT j.*,c.name company_name,c.domain company_domain FROM jobs j JOIN companies c ON c.id=j.company_id
                  WHERE j.eligibility='verified_eligible' AND j.status='open'
                  AND c.id NOT IN (SELECT company_id FROM batches WHERE owner=?)
                  AND j.id NOT IN (SELECT job_id FROM batches WHERE owner=?)
                  ORDER BY j.score DESC, j.published_at DESC LIMIT ?''',(owner,owner,target*10)))
            seen=set();selected=[]
            for j in rows:
                if j['company_id'] in seen: continue
                seen.add(j['company_id']);selected.append(j)
                self.db.execute('INSERT INTO batches(owner,day,company_id,job_id,rank) VALUES(?,?,?,?,?)',(owner,day,j['company_id'],j['id'],len(selected)))
                if len(selected)>=target: break
            self._event('batch_generated',day,{'count':len(selected),'owner':owner})
            self.db.commit();return selected
        except Exception:
            self.db.rollback();raise

    def daily_batch(self,owner,day):
        return _rows(self.db.execute('SELECT j.*,c.name company_name,c.domain company_domain FROM batches b JOIN jobs j ON j.id=b.job_id JOIN companies c ON c.id=b.company_id WHERE b.owner=? AND b.day=? ORDER BY b.rank',(owner,day)))

    def record_application(self,owner,job_id,status,now=None):
        if status not in ('discovered','saved','applied','interviewing','offer','rejected','withdrawn'): raise ValueError('unknown application status')
        at=(now or datetime.now(timezone.utc)).isoformat() if status in ('applied','interviewing','offer','rejected') else None
        self.get_job(job_id)
        self.db.execute('INSERT INTO applications(owner,job_id,status,applied_at) VALUES(?,?,?,?) ON CONFLICT(owner,job_id) DO UPDATE SET status=excluded.status,applied_at=COALESCE(applications.applied_at,excluded.applied_at)',(owner,job_id,status,at))
        self._event('application_updated',job_id,{'status':status,'owner':owner})

    def applications(self,owner):
        return _rows(self.db.execute('SELECT a.*,j.title,c.name company_name FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id WHERE a.owner=? ORDER BY COALESCE(a.applied_at,"") DESC',(owner,)))

    def add_contact(self,company_id,name,title,profile_url,email=None,email_verified=False):
        self.db.execute('INSERT OR IGNORE INTO contacts(id,company_id,name,title,profile_url,email,email_verified) VALUES(?,?,?,?,?,?,?)',(_id(),company_id,name,title,_url(profile_url),email,int(email_verified)))
        return self.db.execute('SELECT id FROM contacts WHERE company_id=? AND profile_url=?',(company_id,_url(profile_url))).fetchone()['id']

    def contacts(self,company_id):return _rows(self.db.execute('SELECT * FROM contacts WHERE company_id=? ORDER BY title',(company_id,)))

    def draft_email(self,owner,job_id,contact_id,subject,body):
        contact=self.db.execute('SELECT company_id FROM contacts WHERE id=?',(contact_id,)).fetchone()
        if not contact or contact['company_id']!=self.get_job(job_id)['company_id']: raise ValueError('contact-company mismatch')
        if not subject.strip() or not body.strip(): raise ValueError('draft incomplete')
        identifier=_id()
        self.db.execute('INSERT INTO outreach(id,owner,job_id,contact_id,subject,body,created_at) VALUES(?,?,?,?,?,?,?)',(identifier,owner,job_id,contact_id,subject,body,_now()))
        return identifier

    def configure_auto_send(self,owner,*,enabled,daily_limit=10,max_per_company=1):
        if not 0<=daily_limit<=20 or not 0<=max_per_company<=2: raise ValueError('unsafe limit')
        self.db.execute('INSERT INTO auto_policies(owner,enabled,daily_limit,company_limit) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,daily_limit=excluded.daily_limit,company_limit=excluded.company_limit',(owner,int(enabled),daily_limit,max_per_company))

    def authorize_message(self,draft_id,mode='manual'):
        if mode not in ('manual','auto'): return False
        self.db.execute('BEGIN IMMEDIATE')
        try:
            row=self.db.execute('''SELECT o.*, c.email,c.email_verified,c.company_id,a.status application_status FROM outreach o JOIN contacts c ON c.id=o.contact_id LEFT JOIN applications a ON a.job_id=o.job_id AND a.owner=o.owner WHERE o.id=?''',(draft_id,)).fetchone()
            if not row: raise KeyError(draft_id)
            if row['status']=='approved':
                self.db.commit(); return True
            if row['status']!='draft' or row['application_status'] not in ('applied','interviewing'):
                self.db.commit(); return False
            if not row['email'] or not row['email_verified'] or self.db.execute('SELECT 1 FROM suppression WHERE email=?',(row['email'].lower(),)).fetchone():
                self.db.commit(); return False
            if mode=='auto':
                policy=self.db.execute('SELECT * FROM auto_policies WHERE owner=?',(row['owner'],)).fetchone()
                if not policy or not policy['enabled']:
                    self.db.commit(); return False
                daily=self.db.execute("SELECT count(*) FROM outreach WHERE owner=? AND auth_mode='auto' AND substr(approved_at,1,10)=date('now')",(row['owner'],)).fetchone()[0]
                company=self.db.execute("SELECT count(*) FROM outreach o JOIN contacts c ON c.id=o.contact_id WHERE o.owner=? AND c.company_id=? AND o.auth_mode='auto' AND substr(o.approved_at,1,10)=date('now')",(row['owner'],row['company_id'])).fetchone()[0]
                if daily>=policy['daily_limit'] or company>=policy['company_limit']:
                    self.db.commit(); return False
            self.db.execute('UPDATE outreach SET status=?,auth_mode=?,approved_at=? WHERE id=?',('approved',mode,_now(),draft_id))
            self._event('outreach_approved',draft_id,{'mode':mode})
            self.db.commit(); return True
        except Exception:
            self.db.rollback(); raise

    def dispatch_status(self,draft_id):
        row=self.db.execute('SELECT status FROM outreach WHERE id=?',(draft_id,)).fetchone()
        if row is None: raise KeyError(draft_id)
        return row['status']

    def suppress(self,email,reason='recipient opted out'):
        self.db.execute('INSERT OR REPLACE INTO suppression(email,reason) VALUES(?,?)',(email.lower(),reason))
        self._event('recipient_suppressed',None,{'email_hash':sha256(email.lower().encode()).hexdigest()})

    def ingest_vault(self,root):
        root=Path(root)
        if not root.is_dir():raise ValueError('knowledge vault directory does not exist')
        approved={}
        for f in root.rglob('*.md'):
            note=parse_note(f.relative_to(root).as_posix(),f.read_text(encoding='utf8'))
            if note:approved[note.path]=note
        self.db.execute('BEGIN IMMEDIATE')
        try:
            old={r['path']:r['sha'] for r in self.db.execute('SELECT path,sha FROM knowledge')}
            for path,note in approved.items():
                if old.get(path)!=note.sha256:
                    self.db.execute('INSERT INTO knowledge(path,sha,body,visibility) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET sha=excluded.sha,body=excluded.body,visibility=excluded.visibility',(path,note.sha256,note.body,note.metadata['visibility']))
                    self.db.execute('INSERT INTO knowledge_events(path,action,sha,created_at) VALUES(?,?,?,?)',(path,'upsert',note.sha256,_now()))
            for path in old.keys()-approved.keys():
                self.db.execute('DELETE FROM knowledge WHERE path=?',(path,))
                self.db.execute('INSERT INTO knowledge_events(path,action,sha,created_at) VALUES(?,?,?,?)',(path,'delete',old[path],_now()))
            self.db.commit();return len(approved)
        except Exception:self.db.rollback();raise

    def knowledge_for(self,agent):
        scopes={'matching':('matching-safe','agents-safe'),'people':('agents-safe',),'outreach':('outreach-safe','agents-safe'),'eligibility':('agents-safe',),'discovery':('agents-safe',),'conversation':('outreach-safe','agents-safe')}
        allowed=scopes.get(agent,('agents-safe',))
        placeholders=','.join('?' for _ in allowed)
        return '\n\n'.join(r['body'] for r in self.db.execute(f'SELECT body FROM knowledge WHERE visibility IN ({placeholders}) ORDER BY path',allowed))

    def save_intelligence(self,company_id,claim,source_url,confidence='unverified',job_id=None):
        if confidence not in ('official','employer','corroborating','unverified'):raise ValueError('invalid evidence')
        _url(source_url)
        ident=_id();self.db.execute('INSERT INTO intel VALUES(?,?,?,?,?,?,?)',(ident,company_id,job_id,claim,source_url,confidence,_now()))
        return ident

    def intelligence(self,company_id):return _rows(self.db.execute('SELECT * FROM intel WHERE company_id=? ORDER BY observed_at DESC',(company_id,)))

    def pending_research(self,kind=None):
        if kind:return _rows(self.db.execute("SELECT * FROM research_queue WHERE status='pending' AND kind=? ORDER BY created_at",(kind,)))
        return _rows(self.db.execute("SELECT * FROM research_queue WHERE status='pending' ORDER BY created_at"))

    def dashboard_metrics(self,owner):
        def count(table):return self.db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
        return {'companies':count('companies'),'jobs':count('jobs'),'boards':count('boards'),'contacts':count('contacts'),
                'applications':self.db.execute('SELECT count(*) FROM applications WHERE owner=?',(owner,)).fetchone()[0],
                'approved_outreach':self.db.execute("SELECT count(*) FROM outreach WHERE owner=? AND status='approved'",(owner,)).fetchone()[0]}
