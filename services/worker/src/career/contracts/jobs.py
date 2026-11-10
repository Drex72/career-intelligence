"""Validated boundaries for external job data and agent handoffs."""
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, AnyHttpUrl, Field, model_validator


class JobCandidate(BaseModel):
    source: str = Field(min_length=1)
    source_job_id: str | None
    company_name: str = Field(min_length=1)
    company_domain: str | None
    title: str = Field(min_length=1)
    description: str
    apply_url: AnyHttpUrl
    remote_text: str | None
    published_at: datetime | None
    updated_at: datetime | None
    first_seen_at: datetime
    timestamp_source: str
    timestamp_confidence: Literal['authoritative', 'inferred', 'unknown']
    source_url: AnyHttpUrl


class EligibilityDecision(BaseModel):
    status: Literal['verified_eligible', 'likely_eligible', 'unknown', 'ineligible']
    reasons: list[str] = Field(default_factory=list)
    evidence_ids: list[UUID] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    policy_version: str = Field(min_length=1)

    @model_validator(mode='after')
    def validate_verified_evidence(self):
        if self.status == 'verified_eligible' and not self.evidence_ids:
            raise ValueError('verified eligibility requires source evidence')
        return self


class MatchResult(BaseModel):
    job_id: UUID
    score: int = Field(ge=0, le=100)
    matched: list[str]
    gaps: list[str]
    knowledge_revision: str


class TaskRequest(BaseModel):
    workflow_id: UUID
    task_type: str = Field(min_length=1)
    input_ref: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    depends_on: list[UUID] = Field(default_factory=list)
