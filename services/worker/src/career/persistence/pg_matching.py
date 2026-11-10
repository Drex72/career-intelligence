"""Evidence-gated, reproducible skill matching over approved personal knowledge."""
from __future__ import annotations
from hashlib import sha256
import json
from typing import Sequence
from career.agents import score_match
from career.persistence.pg_knowledge import retrieve_knowledge


def rank_verified_jobs(catalog, *, job_ids: Sequence[str] | None = None, limit: int = 100) -> dict:
    """Persist one match per job and knowledge revision; never rank unverified roles.

    A revision hashes only the approved matching-visible documents. A changed or
    deleted vault note creates a new revision; reruns at the same revision are
    idempotent. Input job_ids scopes the operation for bounded worker execution.
    """
    if not 1 <= limit <= 500:
        raise ValueError('matching limit must be 1..500')
    if job_ids is not None and len(job_ids) > 500:
        raise ValueError('too many job ids')
    knowledge = retrieve_knowledge(catalog, 'matching')
    if not knowledge.strip():
        return {'ranked': 0, 'reason': 'no approved matching knowledge'}
    allowed = ('matching-safe', 'agents-safe')
    docs = catalog.conn.execute('''SELECT path,content_sha FROM ci_knowledge_documents
        WHERE status='approved' AND visibility = ANY(%s) ORDER BY path''', (list(allowed),)).fetchall()
    revision = sha256('\n'.join(f"{r['path']}:{r['content_sha']}" for r in docs).encode()).hexdigest()
    if job_ids is not None and not job_ids:
        return {'ranked': 0, 'knowledge_revision': revision}
    ids = list(job_ids) if job_ids is not None else None
    candidates = catalog.conn.execute('''SELECT j.id,j.title,j.remote_text
        FROM ci_jobs j
        JOIN LATERAL (SELECT a.status,a.expires_at FROM ci_eligibility_assessments a
             WHERE a.job_id=j.id ORDER BY a.assessed_at DESC,a.id DESC LIMIT 1) a ON TRUE
        WHERE j.status='open' AND a.status='verified_eligible'
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND EXISTS (SELECT 1 FROM ci_eligibility_evidence e WHERE e.job_id=j.id)
          AND (%s::uuid[] IS NULL OR j.id=ANY(%s::uuid[]))
        ORDER BY j.published_at DESC NULLS LAST,j.first_seen_at DESC LIMIT %s''',
        (ids, ids, limit)).fetchall()
    with catalog.conn.transaction():
        for job in candidates:
            result = score_match(' '.join((job['title'], job['remote_text'] or '')), knowledge)
            catalog.conn.execute('''INSERT INTO ci_job_matches
                (job_id,knowledge_revision,score,matched,gaps)
                VALUES (%s,%s,%s,%s::jsonb,%s::jsonb)
                ON CONFLICT(job_id,knowledge_revision) DO UPDATE SET
                  score=excluded.score,matched=excluded.matched,gaps=excluded.gaps,
                  computed_at=now()''',
                (job['id'], revision, result.score,
                 json.dumps(result.matched),json.dumps(result.missing)))
    return {'ranked': len(candidates), 'knowledge_revision': revision}
