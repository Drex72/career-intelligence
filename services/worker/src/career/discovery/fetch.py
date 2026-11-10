"""Bounded public ATS retrieval; no browser automation or bypassing restrictions."""
from datetime import datetime
import re
import httpx
from career.contracts.jobs import JobCandidate
from career.discovery.sources import normalize_greenhouse, normalize_lever, normalize_ashby


class SourceRateLimited(RuntimeError):
    def __init__(self, retry_after: str | None):
        super().__init__(f'rate limited; retry after {retry_after or "unspecified"}')
        self.retry_after = retry_after


ENDPOINTS = {
    'greenhouse': 'https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true',
    'lever': 'https://api.lever.co/v0/postings/{board}?mode=json',
    'ashby': 'https://api.ashbyhq.com/posting-api/job-board/{board}',
}
NORMALIZERS = {'greenhouse': normalize_greenhouse, 'lever': normalize_lever, 'ashby': normalize_ashby}


async def fetch_board(source: str, board: str, company_name: str, company_domain: str | None,
                      client: httpx.AsyncClient, now: datetime, limit: int = 500) -> list[JobCandidate]:
    if source not in ENDPOINTS:
        raise ValueError('unsupported source')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', board):
        raise ValueError('invalid ATS board identifier')
    if not 1 <= limit <= 500:
        raise ValueError('source limit must be 1..500')
    response = await client.get(ENDPOINTS[source].format(board=board), timeout=15.0)
    if response.status_code == 429:
        raise SourceRateLimited(response.headers.get('Retry-After'))
    response.raise_for_status()
    payload = response.json()
    rows = payload if isinstance(payload, list) else payload.get('jobs', [])
    if not isinstance(rows, list):
        raise ValueError('malformed source job listing')
    normalize = NORMALIZERS[source]
    return [normalize(item, company_name, company_domain, now) for item in rows[:limit]]
