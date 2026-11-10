"""Fail-closed parsing and bounded discovery of explicitly approved Obsidian notes.

The source vault must live in a separate private repository. Raw unapproved,
private or oversized note contents are never returned to callers or indexed.
"""
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path, PurePosixPath

MAX_NOTE_BYTES = 32_768
MAX_APPROVED_NOTES = 500
_ALLOWED_VISIBILITIES = frozenset(("matching-safe", "outreach-safe", "agents-safe"))


@dataclass(frozen=True)
class KnowledgeDocument:
    path: str
    body: str
    metadata: dict[str, str]
    sha256: str


def permitted_path(path: str) -> bool:
    p = PurePosixPath(path)
    if p.is_absolute() or p.suffix.lower() != ".md" or len(p.parts) < 2:
        return False
    if "\\" in path or any(x in ("", ".", "..") for x in p.parts):
        return False
    return not any(
        part.startswith(".") or part.lower() in ("07-private", "private", "secrets")
        for part in p.parts
    )


def parse_note(path: str, markdown: str) -> KnowledgeDocument | None:
    if not permitted_path(path) or not isinstance(markdown, str):
        return None
    if "\x00" in markdown or len(markdown.encode("utf-8")) > MAX_NOTE_BYTES:
        return None
    # Delimiters must occupy whole lines. Reject ambiguous or duplicate fields.
    if not markdown.startswith("---\n"):
        return None
    lines = markdown.splitlines(keepends=True)
    try:
        end = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration:
        return None
    if end > 35:
        return None
    metadata: dict[str, str] = {}
    for line in lines[1:end]:
        if ":" not in line:
            return None
        key, value = line.split(":", 1)
        key = key.strip()
        if key in metadata or key not in ("status", "visibility", "title", "verification", "source"):
            return None
        value = value.strip().strip('"\'')
        if not value or any(c in value for c in "\r\n\x00") or len(value) > 300:
            return None
        metadata[key] = value
    if metadata.get("status") != "approved":
        return None
    if metadata.get("visibility") not in _ALLOWED_VISIBILITIES:
        return None
    body = "".join(lines[end + 1:])
    if not body.strip():
        return None
    return KnowledgeDocument(path, body, metadata, sha256(markdown.encode("utf-8")).hexdigest())


def scan_approved_vault(root: str | Path) -> tuple[dict[str, KnowledgeDocument], int]:
    """Return approved content, skipped count; throw on truncation rather than deleting rows."""
    directory = Path(root).resolve()
    if not directory.is_dir():
        raise ValueError("An existing private vault directory is required")
    approved: dict[str, KnowledgeDocument] = {}
    skipped = 0
    for file in directory.rglob("*.md"):
        relative = file.relative_to(directory).as_posix()
        if not permitted_path(relative):
            continue
        if file.is_symlink() or not file.is_file() or not file.resolve().is_relative_to(directory):
            skipped += 1
            continue
        if file.stat().st_size > MAX_NOTE_BYTES:
            # Never silently drop a previously approved note and tombstone it.
            raise ValueError("Vault contains an oversized note in an indexable path")
        note = parse_note(relative, file.read_text(encoding="utf-8"))
        if note is None:
            skipped += 1
            continue
        approved[relative] = note
        if len(approved) > MAX_APPROVED_NOTES:
            raise ValueError("Approved vault exceeds the bounded note limit")
    return approved, skipped


def diff_revision(before: dict[str, str], after: dict[str, str]) -> dict[str, set[str]]:
    return {"changed": {p for p, h in after.items() if before.get(p) != h},
            "removed": set(before) - set(after)}
