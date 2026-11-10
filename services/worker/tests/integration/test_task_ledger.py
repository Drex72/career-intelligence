from datetime import datetime,timedelta,timezone
from uuid import uuid4
from career.orchestration.local_ledger import LocalTaskLedger

NOW=datetime(2026,11,10,tzinfo=timezone.utc)

def test_idempotent_enqueue_and_persistence(tmp_path):
    path=tmp_path/'tasks.db';wf=uuid4()
    with LocalTaskLedger(path) as l:
        a=l.enqueue(wf,'discover','source:1','same-key')
    with LocalTaskLedger(path) as l:
        b=l.enqueue(wf,'discover','source:1','same-key')
        assert a==b

def test_claim_and_dependency(tmp_path):
    with LocalTaskLedger(tmp_path/'tasks.db') as l:
        w=uuid4();a=l.enqueue(w,'discover','a','a');b=l.enqueue(w,'screen','b','b',depends_on=[a])
        x=l.claim('worker',NOW,30)
        assert x.id == a
        assert l.claim('other',NOW,30) is None
        l.complete(a,'result:a','worker',NOW)
        assert l.claim('other',NOW,30).id == b

def test_lease_expiry_recovery(tmp_path):
    with LocalTaskLedger(tmp_path/'tasks.db') as l:
        a=l.enqueue(uuid4(),'discover','a','a')
        l.claim('crashed',NOW,30)
        assert l.claim('replacement',NOW+timedelta(seconds=31),30).id == a
        assert l.attempts(a)==2

def test_only_owner_can_complete(tmp_path):
    import pytest
    with LocalTaskLedger(tmp_path/'tasks.db') as l:
        a=l.enqueue(uuid4(),'discover','a','a');l.claim('worker',NOW,30)
        with pytest.raises(PermissionError):
            l.complete(a,'result','other',NOW)

def test_complete_is_idempotent(tmp_path):
    with LocalTaskLedger(tmp_path/'tasks.db') as l:
        a=l.enqueue(uuid4(),'discover','a','a');l.claim('worker',NOW,30)
        l.complete(a,'done','worker',NOW)
        l.complete(a,'done','worker',NOW)
        assert l.events(a).count('completed')==1

def test_fail_retries_then_dead_letter(tmp_path):
    with LocalTaskLedger(tmp_path/'tasks.db') as l:
        a=l.enqueue(uuid4(),'discover','a','a',max_attempts=2)
        l.claim('a',NOW,30)
        l.fail(a,'retryable','a',NOW)
        assert l.claim('a',NOW+timedelta(seconds=2),30).id==a
        l.fail(a,'retryable','a',NOW+timedelta(seconds=2))
        assert l.state(a)=='failed'
