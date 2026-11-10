from datetime import datetime, timezone
from career.discovery.sources import normalize_greenhouse, normalize_lever, normalize_ashby

NOW = datetime(2026,11,10,tzinfo=timezone.utc)

def test_greenhouse_normalized():
    row={'id':123,'title':'Backend Engineer','absolute_url':'https://boards.greenhouse.io/demo/jobs/123','updated_at':'2026-11-09T12:00:00Z','first_published':'2026-11-08T10:00:00Z','content':'Remote worldwide including Nigeria'}
    j=normalize_greenhouse(row, 'Demo Labs', 'demo.com', NOW)
    assert j.source_job_id=='123' and j.published_at.isoformat().startswith('2026-11-08')
    assert j.timestamp_confidence=='authoritative'

def test_greenhouse_missing_publication_is_unknown():
    row={'id':1,'title':'Engineer','absolute_url':'https://example.com/1','updated_at':'2026-11-10T00:00:00Z'}
    j=normalize_greenhouse(row,'Example','example.com', NOW)
    assert j.published_at is None and j.timestamp_confidence=='unknown'

def test_lever_normalized():
    row={'id':'abc','text':'Platform Engineer','hostedUrl':'https://jobs.lever.co/demo/abc','createdAt':1794103200000,'descriptionPlain':'Remote worldwide', 'workplaceType':'remote'}
    j=normalize_lever(row,'Demo','demo.com',NOW)
    assert j.title=='Platform Engineer' and j.remote_text=='remote'
    assert j.published_at is not None

def test_ashby_normalized():
    row={'id':'j1','title':'AI Engineer','jobUrl':'https://jobs.ashbyhq.com/demo/j1','publishedAt':'2026-11-08T01:00:00Z','descriptionPlain':'Remote worldwide', 'isRemote':True}
    j=normalize_ashby(row,'Demo','demo.com',NOW)
    assert j.timestamp_confidence=='authoritative' and str(j.apply_url).endswith('j1')

def test_missing_title_fails_validation():
    import pytest
    from pydantic import ValidationError
    row={'id':3,'absolute_url':'https://example.com/3'}
    with pytest.raises(ValidationError):
        normalize_greenhouse(row,'Example','example.com',NOW)
