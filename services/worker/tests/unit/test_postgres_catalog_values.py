import pytest
from career.persistence.postgres_catalog import normalize_domain, canonical_job_url


def test_domain_normalization_rejects_paths_and_removes_www():
    assert normalize_domain(' WWW.Example.COM. ') == 'example.com'
    assert normalize_domain(None) is None
    with pytest.raises(ValueError):
        normalize_domain('example.com/careers')


def test_canonical_job_url_drops_tracking_and_fragments():
    assert canonical_job_url('https://JOBS.example.com/123/?utm_source=reddit&gh_jid=42#jobs') == 'https://jobs.example.com/123?gh_jid=42'
    with pytest.raises(ValueError):
        canonical_job_url('file:///etc/passwd')
