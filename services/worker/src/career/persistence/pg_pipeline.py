"""Bounded, evidence-preserving public discovery into PostgreSQL.

This ingestion pass never marks applicants eligible and cannot send email.
Eligibility requires a separate, source-evidenced job assessment.
"""
from __future__ import annotations

from datetime import datetime, timezone
import httpx
from career.discovery.fetch import fetch_board
from career.pipeline import infer_board_from_url, normalize_remote_feed
from career.persistence.pg_discovery import list_boards, register_board


def persist_candidate(catalog, candidate) -> str:
    return catalog.upsert_job(
        source=candidate.source,
        source_job_id=candidate.source_job_id,
        company_name=candidate.company_name,
        company_domain=candidate.company_domain,
        title=candidate.title,
        apply_url=str(candidate.apply_url),
        published_at=candidate.published_at,
        remote_text=candidate.remote_text,
    )


async def run_pg_discovery(catalog, client: httpx.AsyncClient, search_terms: list[str],
                           *, now: datetime | None = None, board_limit: int = 10) -> dict:
    if not 0 <= board_limit <= 50:
        raise ValueError('board limit must be 0..50')
    now = now or datetime.now(timezone.utc)
    report = {'processed_jobs':0,'source_failures':[],'discovered_boards':0}
    for term in search_terms[:2]:
        if not term.strip():
            continue
        try:
            response = await client.get('https://remotive.com/api/remote-jobs',
                                        params={'search':term,'limit':100},timeout=30)
            response.raise_for_status()
            if len(response.content)>4_000_000:
                raise ValueError('feed response too large')
            for job in normalize_remote_feed(response.json(),now):
                persist_candidate(catalog,job)
                report['processed_jobs']+=1
                detected = infer_board_from_url(str(job.apply_url))
                if detected and board_limit:
                    register_board(catalog,*detected,job.company_name,job.company_domain)
                    report['discovered_boards']+=1
        except (httpx.HTTPError, ValueError, KeyError) as e:
            report['source_failures'].append({'source':'remotive','error':type(e).__name__})
    if board_limit:
        for board in list_boards(catalog,limit=board_limit):
            try:
                jobs=await fetch_board(board['provider'],board['slug'],board['company_name'],
                                       board.get('domain'),client,now,limit=200)
                for job in jobs:
                    persist_candidate(catalog,job)
                    report['processed_jobs']+=1
            except (httpx.HTTPError, ValueError, KeyError,RuntimeError) as e:
                report['source_failures'].append({'source':'ats:'+board['provider']+':'+board['slug'],
                                                  'error':type(e).__name__})
    return report
