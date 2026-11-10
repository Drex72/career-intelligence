"""Store user-supplied recruiter replies without promoting anecdotes to employer policy."""
from __future__ import annotations
import hashlib
import json
import re
from uuid import UUID
from career.agents import classify_reply
from urllib.parse import urlsplit

_US_RESTRICTION = re.compile(r'(?:this|the|our)\s+(?:\w+\s+){0,2}(?:role|position|job)\b.{0,110}\b(?:requires?|restricted|limited)\b.{0,100}\b(?:united states|us residents|u\.s\. residents|usa|us-based)',re.I|re.S)


def classify_employer_reply(body: str) -> dict:
    result = classify_reply(body)
    restricted = bool(_US_RESTRICTION.search(body))
    return {'event_type': result, 'job_restriction': restricted, 'scope': 'job'}


def record_pg_reply(catalog, owner: UUID, *, job_id: str, contact_id: str,
                    body: str, source_url: str) -> dict:
    if not isinstance(owner, UUID) or not job_id or not contact_id:
        raise ValueError('owner, job and contact are required')
    if not 1 <= len(body.strip()) <= 4000:
        raise ValueError('reply body required (maximum 4000 characters)')
    parsed=urlsplit(source_url.strip())
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('secure evidence URL required')
    source=source_url.strip()
    classification=classify_employer_reply(body)
    unique = hashlib.sha256('\n'.join((str(owner),job_id,contact_id,source,body)).encode()).hexdigest()
    provider_id='manual:'+unique
    with catalog.conn.transaction():
        related=catalog.conn.execute('''SELECT j.company_id FROM ci_jobs j
            JOIN ci_contacts p ON p.company_id=j.company_id
            WHERE j.id=%s AND p.id=%s''',(job_id,contact_id)).fetchone()
        if not related:
            raise ValueError('contact does not belong to job company')
        # Only allow a user to log a conversation for a contact/job with an
        # existing outreach draft belonging to this owner.
        approved=catalog.conn.execute('''SELECT 1 FROM ci_outreach_drafts
            WHERE owner_user_id=%s AND job_id=%s AND contact_id=%s LIMIT 1''',
            (owner,job_id,contact_id)).fetchone()
        if not approved:
            raise ValueError('conversation requires existing owner outreach')
        row=catalog.conn.execute('''INSERT INTO ci_conversation_events
             (owner_user_id,job_id,contact_id,event_type,provider_message_id,evidence)
             VALUES (%s,%s,%s,%s,%s,%s::jsonb)
             ON CONFLICT(provider_message_id,event_type) DO NOTHING RETURNING id''',
             (owner,job_id,contact_id,classification['event_type'],provider_id,
              json.dumps({'text':body,'source_url':source,'status':'user_reported'}))).fetchone()
        if row and classification['job_restriction']:
            catalog.conn.execute('''INSERT INTO ci_employer_intelligence
                 (company_id,job_id,claim,scope,evidence_source_url,authority,status)
                 VALUES (%s,%s,%s,'job',%s,'user_reported_direct_message','unverified')''',
                 (related['company_id'],job_id,'US residency required for this position',source))
        return {'recorded': bool(row), 'classification':classification['event_type'],
                'job_restriction':classification['job_restriction']}
