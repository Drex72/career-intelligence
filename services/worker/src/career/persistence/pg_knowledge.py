"""Approved Obsidian Markdown to versioned ci_ PostgreSQL knowledge index.

The vault lives outside the public code repository. Only approved, non-private
notes are indexed. Deleted notes are tombstoned rather than left retrievable.
"""
from __future__ import annotations
from pathlib import Path
import json
from career.knowledge.vault import scan_approved_vault


_SCOPES={
    'discovery':('agents-safe',),
    'eligibility':('agents-safe',),
    'matching':('matching-safe','agents-safe'),
    'people':('agents-safe',),
    'outreach':('outreach-safe','agents-safe'),
    'conversation':('outreach-safe','agents-safe'),
}


def allowed_visibilities(agent_role: str) -> tuple[str,...]:
    return _SCOPES.get(agent_role,())


def sync_vault(catalog, root: str | Path, *, git_sha: str, allow_empty: bool = False) -> int:
    root=Path(root).resolve()
    if not root.is_dir() or not git_sha:
        raise ValueError('approved vault root and revision required')
    approved, skipped = scan_approved_vault(root)
    with catalog.conn.transaction():
        old={r['path']:(r['content_sha'],r['status']) for r in catalog.conn.execute(
            'SELECT path,content_sha,status FROM ci_knowledge_documents').fetchall()}
        # Never erase all previously approved context because a clone was empty,
        # checkout was pointed at the wrong directory, or metadata was invalid.
        if not approved and any(status == 'approved' for _,status in old.values()) and not allow_empty:
            raise ValueError('Refusing to tombstone every approved note: use explicit --allow-empty')
        changed_count = 0
        tombstoned_count = 0
        for path,note in approved.items():
            if old.get(path)==(note.sha256,'approved'):
                continue
            changed_count += 1
            doc=catalog.conn.execute('''INSERT INTO ci_knowledge_documents
                 (path,git_sha,content_sha,visibility,status)
                 VALUES (%s,%s,%s,%s,'approved')
                 ON CONFLICT(path) DO UPDATE SET git_sha=excluded.git_sha,
                    content_sha=excluded.content_sha,visibility=excluded.visibility,
                    status='approved',updated_at=now() RETURNING id''',
                 (path,git_sha,note.sha256,note.metadata['visibility'])).fetchone()['id']
            catalog.conn.execute('''INSERT INTO ci_knowledge_versions
                   (document_id,revision,body,parsed_metadata)
                   VALUES (%s,%s,%s,%s::jsonb) ON CONFLICT(document_id,revision) DO NOTHING''',
                   (doc,note.sha256,note.body,json.dumps(note.metadata)))
        for path in set(old)-set(approved):
            if old[path][1]=='approved':
                tombstoned_count += 1
                catalog.conn.execute('''UPDATE ci_knowledge_documents SET status='deleted',updated_at=now()
                                        WHERE path=%s''',(path,))
        catalog.conn.execute('''INSERT INTO ci_knowledge_sync_runs
             (git_sha,approved_count,changed_count,tombstoned_count,skipped_count)
             VALUES(%s,%s,%s,%s,%s)''',
             (git_sha,len(approved),changed_count,tombstoned_count,skipped))
    return len(approved)


def retrieve_knowledge(catalog, agent_role: str) -> str:
    allowed=allowed_visibilities(agent_role)
    if not allowed:
        return ''
    rows=catalog.conn.execute('''SELECT v.body FROM ci_knowledge_documents d
          JOIN ci_knowledge_versions v ON v.document_id=d.id AND v.revision=d.content_sha
          WHERE d.status='approved' AND d.visibility=ANY(%s)
          ORDER BY d.path''',(list(allowed),)).fetchall()
    return '\n\n'.join(r['body'] for r in rows)
