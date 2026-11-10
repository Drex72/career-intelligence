from career.discovery.identity import canonicalize_url, canonical_domain

def test_tracking_url_ignored():
    assert canonicalize_url('https://Example.com/jobs/1?utm_source=abc&gh_src=foo') == 'https://example.com/jobs/1'

def test_company_domain_normalized():
    assert canonical_domain('https://www.Example.com/careers') == 'example.com'

def test_hosted_ats_not_company_domain():
    assert canonical_domain('https://jobs.lever.co/example') is None
