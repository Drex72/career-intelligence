import subprocess,sys,os

def test_cli_help():
    env=dict(os.environ,PYTHONPATH='services/worker/src')
    p=subprocess.run([sys.executable,'-m','career.cli','--help'],cwd='.',env=env,capture_output=True,text=True)
    assert p.returncode==0
    assert 'discover' in p.stdout and 'serve' in p.stdout and 'vault-sync' in p.stdout
