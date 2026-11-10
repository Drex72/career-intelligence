"""Pure batch selection; transactional lifetime delivery is enforced by PostgreSQL."""
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field
from typing import Literal


class ProposedJob(BaseModel):
    company_id: UUID
    job_id: UUID
    score: int = Field(ge=0, le=100)
    eligibility: Literal['verified_eligible', 'likely_eligible', 'unknown', 'ineligible']
    verified_open: bool
    published_at: datetime | None


def select_daily_batch(candidates: list[ProposedJob], delivered_companies: set[UUID],
                       delivered_jobs: set[UUID], now: datetime,
                       target: int = 100) -> list[ProposedJob]:
    if not 1 <= target <= 100:
        raise ValueError('daily company target must be between 1 and 100')
    ordered = sorted(candidates, key=lambda j: (j.score, j.published_at or datetime.min.replace(tzinfo=now.tzinfo)), reverse=True)
    selected: list[ProposedJob] = []
    seen_companies = set(delivered_companies)
    seen_jobs = set(delivered_jobs)
    for candidate in ordered:
        if candidate.eligibility != 'verified_eligible' or not candidate.verified_open:
            continue
        if candidate.company_id in seen_companies or candidate.job_id in seen_jobs:
            continue
        selected.append(candidate)
        seen_companies.add(candidate.company_id)
        seen_jobs.add(candidate.job_id)
        if len(selected) >= target:
            break
    return selected
