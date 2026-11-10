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
        with pytest.raises(ValueError, match='Refusing to tombstone'):
            sync_vault(catalog,tmp_path,git_sha='local')
        assert 'Reduced API' in retrieve_knowledge(catalog,'outreach')
        assert sync_vault(catalog,tmp_path,git_sha='local',allow_empty=True)==0
        assert 'Reduced API' not in retrieve_knowledge(catalog,'outreach')


def test_vault_audit_private_scope_and_changed_revision(tmp_path):
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    from career.persistence.pg_knowledge import sync_vault,retrieve_knowledge
    (tmp_path/'03-skills').mkdir()
    (tmp_path/'07-private').mkdir()
    approved=tmp_path/'03-skills'/'source.md'
    approved.write_text('---\nstatus: approved\nvisibility: matching-safe\n---\nPython and backend experience\n')
    (tmp_path/'07-private'/'sensitive.md').write_text('---\nstatus: approved\nvisibility: agents-safe\n---\nNEVER INDEX THIS\n')
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        assert sync_vault(catalog,tmp_path,git_sha='a'*40)==1
        assert sync_vault(catalog,tmp_path,git_sha='a'*40)==1
        assert 'Python' in retrieve_knowledge(catalog,'matching')
        assert 'NEVER INDEX THIS' not in retrieve_knowledge(catalog,'matching')
        audit=catalog.conn.execute('''SELECT approved_count,changed_count,tombstoned_count
          FROM ci_knowledge_sync_runs ORDER BY finished_at DESC,id DESC LIMIT 2''').fetchall()
        assert len(audit)==2
        assert sorted(r['changed_count'] for r in audit)==[0,1]
        approved.write_text('---\nstatus: approved\nvisibility: matching-safe\n---\nPython, PostgreSQL and Docker\n')
        assert sync_vault(catalog,tmp_path,git_sha='b'*40)==1
        assert 'Docker' in retrieve_knowledge(catalog,'matching')
        assert 'NEVER INDEX THIS' not in retrieve_knowledge(catalog,'outreach')


def test_private_knowledge_tables_reject_browser_roles():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert not db.execute(
                "select has_table_privilege(%s,'ci_knowledge_sync_runs','SELECT')",
                (role,)).fetchone()[0]
            assert not db.execute(
                "select has_table_privilege(%s,'ci_knowledge_versions','SELECT')",
                (role,)).fetchone()[0]
