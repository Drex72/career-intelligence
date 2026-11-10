"""Pure, offline-testable normalization for public ATS job board responses.

The network adapters must independently verify API usage rules and fields for
current providers before production activation.
"""
from datetime import datetime, timezone
from typing import Any
from career.contracts.jobs import JobCandidate


def _parse_date(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, timezone.utc)
    if isinstance(value, str) and value.strip():
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    return None


def _make(*, source: str, row: dict, company_name: str, company_domain: str | None,
          now: datetime, identity: str | None, title: str | None, description: str,
          url: str | None, publication: Any, updated: Any, remote: str | None,
          publication_source: str) -> JobCandidate:
    return JobCandidate(source=source, source_job_id=str(identity) if identity is not None else None,
                        company_name=company_name, company_domain=company_domain,
                        title=title or '', description=description, apply_url=url,
                        remote_text=remote, published_at=_parse_date(publication),
                        updated_at=_parse_date(updated), first_seen_at=now,
                        timestamp_source=publication_source if publication is not None else 'unknown',
                        timestamp_confidence='authoritative' if publication is not None else 'unknown',
                        source_url=url)


def normalize_greenhouse(row: dict, company_name: str, company_domain: str | None,
                         now: datetime) -> JobCandidate:
    publication = row.get('first_published') or row.get('internal_job_id_published_at')
    return _make(source='greenhouse', row=row, company_name=company_name,
                 company_domain=company_domain, now=now, identity=row.get('id'),
                 title=row.get('title'), description=row.get('content') or '',
                 url=row.get('absolute_url'), publication=publication,
                 updated=row.get('updated_at'), remote=(row.get('location') or {}).get('name')
                 if isinstance(row.get('location'), dict) else None,
                 publication_source='first_published')


def normalize_lever(row: dict, company_name: str, company_domain: str | None,
                    now: datetime) -> JobCandidate:
    return _make(source='lever', row=row, company_name=company_name,
                 company_domain=company_domain, now=now, identity=row.get('id'),
                 title=row.get('text'), description=row.get('descriptionPlain') or '',
                 url=row.get('hostedUrl') or row.get('applyUrl'),
                 publication=row.get('createdAt'), updated=row.get('updatedAt'),
                 remote=row.get('workplaceType'), publication_source='createdAt')


def normalize_ashby(row: dict, company_name: str, company_domain: str | None,
                    now: datetime) -> JobCandidate:
    return _make(source='ashby', row=row, company_name=company_name,
                 company_domain=company_domain, now=now, identity=row.get('id'),
                 title=row.get('title'), description=row.get('descriptionPlain') or '',
                 url=row.get('jobUrl') or row.get('applyUrl'),
                 publication=row.get('publishedAt'), updated=row.get('updatedAt'),
                 remote='remote' if row.get('isRemote') is True else None,
                 publication_source='publishedAt')
