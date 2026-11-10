"""Idempotent, evidence-gated draft creation. Never dispatches email."""
from __future__ import annotations
from hashlib import sha256
from uuid import UUID
from career.agents import build_outreach
from career.persistence.pg_knowledge import retrieve_knowledge


def prepare_pg_draft(catalog, owner: UUID, job_id: str, contact_id: str) -> str:
    if not isinstance(owner, UUID):
        raise ValueError('owner UUID required')
    if not job_id or not contact_id:
        raise ValueError('job and contact required')
    knowledge=retrieve_knowledge(catalog,'outreach').strip()
    if not knowledge:
        raise ValueError('approved outreach knowledge required')
    # Only use approved factual material. Never assume a shared connection.
    excerpt=' '.join(knowledge.split())[:500].rsplit(' ',1)[0]
    if not excerpt:
        raise ValueError('approved outreach knowledge required')
    with catalog.conn.transaction():
        catalog.conn.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',
                             (f'ci-draft:{owner}:{job_id}:{contact_id}',))
        existing=catalog.conn.execute('''SELECT id FROM ci_outreach_drafts WHERE
            owner_user_id=%s AND job_id=%s AND contact_id=%s AND status<>'cancelled'
            ORDER BY created_at DESC LIMIT 1''',(owner,job_id,contact_id)).fetchone()
        if existing:
            return str(existing['id'])
        row=catalog.conn.execute('''SELECT j.id,j.title,j.status,c.legal_name,
                  p.name AS contact_name,p.company_id
            FROM ci_jobs j JOIN ci_companies c ON c.id=j.company_id
              JOIN ci_contacts p ON p.company_id=c.id
            WHERE j.id=%s AND p.id=%s''',(job_id,contact_id)).fetchone()
        if not row:
            raise ValueError('job and contact must belong to the same company')
        if row['status']!='open':
            raise ValueError('job must be open')
        latest=catalog.conn.execute('''SELECT status FROM ci_eligibility_assessments
            WHERE job_id=%s ORDER BY assessed_at DESC,id DESC LIMIT 1''',(job_id,)).fetchone()
        if not latest or latest['status']!='verified_eligible':
            raise ValueError('verified job eligibility required')
        draft=build_outreach(row['contact_name'].split()[0],row['title'],row['legal_name'],excerpt)
        docs=catalog.conn.execute('''SELECT path,content_sha FROM ci_knowledge_documents
            WHERE status='approved' AND visibility IN ('outreach-safe','agents-safe')
            ORDER BY path''').fetchall()
        revision=sha256('\n'.join(f"{x['path']}:{x['content_sha']}" for x in docs).encode()).hexdigest()
        result=catalog.conn.execute('''INSERT INTO ci_outreach_drafts
              (owner_user_id,job_id,contact_id,subject,body,knowledge_revision,status)
            VALUES (%s,%s,%s,%s,%s,%s,'draft') RETURNING id''',
            (owner,job_id,contact_id,draft['subject'],draft['body'],revision)).fetchone()
        return str(result['id'])
