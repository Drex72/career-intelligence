import os
import pytest
from uuid import uuid4
pytestmark=pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='disposable PostgreSQL DB required')


def test_pg_vault_sync_revisions_and_deleted_notes(tmp_path):
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    from career.persistence.pg_knowledge import sync_vault,retrieve_knowledge
    folder='01-experience';(tmp_path/folder).mkdir();(tmp_path/'07-private').mkdir()
    name=uuid4().hex+'.md'
    note=tmp_path/folder/name
    content='---\nstatus: approved\nvisibility: outreach-safe\n---\nReduced API compute by 95%.\n'
    note.write_text(content)
    (tmp_path/'07-private'/'secrets.md').write_text('---\nstatus: approved\nvisibility: agents-safe\n---\nPRIVATE SECRET\n')
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        assert sync_vault(catalog,tmp_path,git_sha='local')==1
        assert 'Reduced API' in retrieve_knowledge(catalog,'outreach')
        assert 'PRIVATE SECRET' not in retrieve_knowledge(catalog,'outreach')
        assert 'Reduced API' not in retrieve_knowledge(catalog,'matching')
        note.unlink()
        assert sync_vault(catalog,tmp_path,git_sha='local')==0
        assert 'Reduced API' not in retrieve_knowledge(catalog,'outreach')
