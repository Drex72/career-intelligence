from datetime import datetime, timezone
from uuid import uuid4
import pytest
from pydantic import ValidationError
from career.contracts.jobs import JobCandidate, EligibilityDecision, TaskRequest

JOB = dict(source='test', source_job_id='a1', company_name='Example', company_domain='example.com', title='Backend Engineer', description='Remote worldwide, including Nigeria.', apply_url='https://example.com/jobs/1', remote_text='Worldwide remote', published_at=datetime(2026,11,10,tzinfo=timezone.utc), updated_at=None, first_seen_at=datetime(2026,11,10,tzinfo=timezone.utc), timestamp_source='posted_at', timestamp_confidence='authoritative', source_url='https://example.com/jobs/1')

def test_valid_job_candidate():
    assert JobCandidate.model_validate(JOB).source_job_id == 'a1'

def test_verified_eligible_requires_evidence():
    with pytest.raises(ValidationError):
        EligibilityDecision(status='verified_eligible', reasons=['remote'], evidence_ids=[], contradictions=[], confidence=.8, policy_version='1')

def test_confidence_bounded():
    with pytest.raises(ValidationError):
        EligibilityDecision(status='unknown', reasons=[], evidence_ids=[], contradictions=[], confidence=1.5, policy_version='1')

def test_task_idempotency_key_required():
    with pytest.raises(ValidationError):
        TaskRequest(workflow_id=uuid4(), task_type='discover', input_ref='a', idempotency_key='')
