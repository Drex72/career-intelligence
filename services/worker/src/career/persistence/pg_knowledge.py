"""Approved Obsidian Markdown to versioned ci_ PostgreSQL knowledge index.

The vault lives outside the public code repository. Only approved, non-private
notes are indexed. Deleted notes are tombstoned rather than left retrievable.
"""
from __future__ import annotations
from pathlib import Path
import json
from career.knowledge.vault import parse_note


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


def sync_vault(catalog, root: str | Path, *, git_sha: str) -> int:
    root=Path(root).resolve()
    if not root.is_dir() or not git_sha:
        raise ValueError('approved vault root and revision required')
    approved={}
    for f in root.rglob('*.md'):
        if not f.is_file() or not f.resolve().is_relative_to(root):
            continue
        rel=f.relative_to(root).as_posix()
        note=parse_note(rel,f.read_text(encoding='utf-8'))
        if note:
            approved[rel]=note
    with catalog.conn.transaction():
        old={r['path']:(r['content_sha'],r['status']) for r in catalog.conn.execute(
            'SELECT path,content_sha,status FROM ci_knowledge_documents').fetchall()}
        for path,note in approved.items():
            if old.get(path)==(note.sha256,'approved'):
                continue
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
                catalog.conn.execute('''UPDATE ci_knowledge_documents SET status='deleted',updated_at=now()
                                        WHERE path=%s''',(path,))
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
