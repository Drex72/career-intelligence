from datetime import datetime,timezone
from uuid import uuid4
from career.discovery.batches import ProposedJob, select_daily_batch
NOW = datetime(2026,11,10,tzinfo=timezone.utc)

def entry(company, job, score=90, eligibility='verified_eligible'):
    return ProposedJob(company_id=company,job_id=job,score=score,eligibility=eligibility,verified_open=True,published_at=NOW)

def test_one_primary_job_per_company():
    c=uuid4();a=entry(c,uuid4(),70);b=entry(c,uuid4(),95)
    assert select_daily_batch([a,b],set(),set(),NOW)[0].job_id == b.job_id

def test_exclude_delivered_companies():
    c=uuid4()
    assert select_daily_batch([entry(c,uuid4())],{c},set(),NOW)==[]

def test_only_verified_eligible_and_open():
    a=entry(uuid4(),uuid4(),eligibility='likely_eligible')
    b=entry(uuid4(),uuid4());b=b.model_copy(update={'verified_open':False})
    assert select_daily_batch([a,b],set(),set(),NOW)==[]

def test_max_100():
    batch=select_daily_batch([entry(uuid4(),uuid4()) for _ in range(105)],set(),set(),NOW)
    assert len(batch)==100

def test_delivered_job_suppressed():
    c=uuid4();j=uuid4()
    assert select_daily_batch([entry(c,j)],set(),{j},NOW)==[]

def test_sorted_by_score():
    a=entry(uuid4(),uuid4(),5);b=entry(uuid4(),uuid4(),99)
    assert select_daily_batch([a,b],set(),set(),NOW)[0].job_id == b.job_id
