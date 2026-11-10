from pathlib import Path


def test_scheduled_worker_is_explicit_opt_in_and_never_sends_mail():
    path=Path(__file__).resolve().parents[4]/'.github/workflows/ci-discovery.yml'
    content=path.read_text()
    assert 'CI_AUTO_RUN' in content
    assert 'CI_DATABASE_URL' in content
    assert 'CI_OWNER_UUID' in content
    assert 'pg-discover' in content
    assert 'pg-generate-batch' in content
    assert 'send-email' not in content
