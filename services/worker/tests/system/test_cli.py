import subprocess,sys,os

def test_cli_help():
    env=dict(os.environ,PYTHONPATH='services/worker/src')
    p=subprocess.run([sys.executable,'-m','career.cli','--help'],cwd='.',env=env,capture_output=True,text=True)
    assert p.returncode==0
    assert 'discover' in p.stdout and 'serve' in p.stdout and 'vault-sync' in p.stdout

def test_cli_exposes_postgres_operations_without_credentials():
    env=dict(os.environ,PYTHONPATH='services/worker/src')
    p=subprocess.run([sys.executable,'-m','career.cli','--help'],cwd='.',env=env,capture_output=True,text=True)
    assert 'pg-discover' in p.stdout
    assert 'pg-generate-batch' in p.stdout
    assert 'pg-add-board' in p.stdout
    assert 'pg-research-eligibility' in p.stdout
    assert 'pg-serve' in p.stdout
    assert 'pg-research-people' in p.stdout
    assert 'pg-vault-sync' in p.stdout
