from datetime import datetime,timezone
from uuid import uuid4
from career.discovery.batches import ProposedJob
from career.discovery.local_store import LocalBatchStore

NOW=datetime(2026,11,10,tzinfo=timezone.utc)

def candidate(c,j):
    return ProposedJob(company_id=c,job_id=j,score=90,eligibility='verified_eligible',verified_open=True,published_at=NOW)

def test_delivery_persists_across_process_instances(tmp_path):
    path=tmp_path/'data.db'; c=uuid4();j=uuid4();
    with LocalBatchStore(path) as store:
        assert store.deliver('owner','2026-11-10',[candidate(c,j)])==[j]
    with LocalBatchStore(path) as store:
        assert store.deliver('owner','2026-11-11',[candidate(c,j)])==[]
        assert store.history('owner')==[(str(c),str(j),'2026-11-10')]

def test_same_day_retry_is_idempotent(tmp_path):
    c=uuid4();j=uuid4()
    with LocalBatchStore(tmp_path/'x.db') as store:
        assert store.deliver('owner','2026-11-10',[candidate(c,j)])==[j]
        assert store.deliver('owner','2026-11-10',[candidate(c,j)])==[]

def test_separate_owners_have_separate_history(tmp_path):
    c=uuid4();j=uuid4()
    with LocalBatchStore(tmp_path/'x.db') as store:
        assert store.deliver('a','2026-11-10',[candidate(c,j)])==[j]
        assert store.deliver('b','2026-11-10',[candidate(c,j)])==[j]

def test_unverified_job_not_delivered(tmp_path):
    c=uuid4();j=uuid4();bad=candidate(c,j).model_copy(update={'eligibility':'unknown'})
    with LocalBatchStore(tmp_path/'x.db') as store:
        assert store.deliver('owner','2026-11-10',[bad])==[]
