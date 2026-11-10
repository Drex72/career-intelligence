"""Approved Markdown ingestion, without indexing private vault paths."""
from dataclasses import dataclass
from hashlib import sha256
from pathlib import PurePosixPath

@dataclass(frozen=True)
class KnowledgeDocument:
    path: str
    body: str
    metadata: dict[str, str]
    sha256: str


def permitted_path(path: str) -> bool:
    p = PurePosixPath(path)
    return (not p.is_absolute() and '..' not in p.parts and '07-private' not in p.parts
            and p.suffix.lower() == '.md' and len(p.parts) >= 2
            and not any(part.startswith('.') for part in p.parts))


def parse_note(path: str, markdown: str) -> KnowledgeDocument | None:
    if not permitted_path(path) or not markdown.startswith('---\n'):
        return None
    parts = markdown.split('---\n', 2)
    if len(parts) != 3:
        return None
    metadata = {}
    for line in parts[1].splitlines():
        if ':' in line:
            key, value = line.split(':', 1)
            metadata[key.strip()] = value.strip().strip('"\'')
    if metadata.get('status') != 'approved':
        return None
    if metadata.get('visibility') not in ('matching-safe', 'outreach-safe', 'agents-safe'):
        return None
    return KnowledgeDocument(path, parts[2], metadata, sha256(markdown.encode()).hexdigest())


def diff_revision(before: dict[str, str], after: dict[str, str]) -> dict[str, set[str]]:
    return {'changed': {p for p, h in after.items() if before.get(p) != h},
            'removed': set(before) - set(after)}
