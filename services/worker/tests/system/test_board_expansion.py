from career.pipeline import infer_board_from_url

def test_infer_ats_from_discovered_apply_urls():
    assert infer_board_from_url('https://jobs.lever.co/astro-labs/abc')==('lever','astro-labs')
    assert infer_board_from_url('https://boards.greenhouse.io/examplecorp/jobs/123')==('greenhouse','examplecorp')
    assert infer_board_from_url('https://jobs.ashbyhq.com/mystartup/abc')==('ashby','mystartup')
    assert infer_board_from_url('https://random.com/example') is None
    assert infer_board_from_url('https://evil.com/redirect?next=jobs.lever.co/alpha') is None
