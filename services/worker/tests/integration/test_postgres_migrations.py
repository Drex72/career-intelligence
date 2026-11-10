"""Apply every migration to a disposable Postgres instance, never to production."""
from pathlib import Path
import os
import pytest


@pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='isolated PostgreSQL test DB not configured')
def test_all_migrations_apply_and_protect_public_tables():
    import psycopg

    dsn = os.environ['PG_TEST_DSN']
    with psycopg.connect(dsn, autocommit=True) as conn:
        # Mimic only the minimal Supabase auth schema and roles required for RLS.
        conn.execute('CREATE SCHEMA IF NOT EXISTS auth')
        conn.execute('''CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
                        LANGUAGE SQL STABLE AS $$ SELECT null::uuid $$''')
        for role in ('anon', 'authenticated'):
            conn.execute('DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'%s\') THEN CREATE ROLE %s NOLOGIN; END IF; END $$' % (role, role))
        # Guardrail for sharing Groundwork's database: existing objects and
        # their grants must remain unchanged after all CI migrations.
        conn.execute('CREATE TABLE IF NOT EXISTS groundwork_guard (id int primary key)')
        conn.execute('INSERT INTO groundwork_guard(id) VALUES (7) ON CONFLICT DO NOTHING')
        conn.execute('GRANT SELECT ON groundwork_guard TO authenticated')
        before_grant = conn.execute("SELECT has_table_privilege('authenticated', 'public.groundwork_guard', 'SELECT')").fetchone()[0]
        assert before_grant is True
        root = Path(__file__).resolve().parents[4] / 'supabase' / 'migrations'
        assert root.is_dir(), f'migrations missing: {root}'
        migrations = sorted(root.glob('*.sql'))
        assert len(migrations) >= 7
        for migration in migrations:
            conn.execute(migration.read_text(encoding='utf-8'))
        tables = conn.execute('''SELECT relname, relrowsecurity FROM pg_class
            WHERE relnamespace='public'::regnamespace AND relkind='r'
              AND left(relname,3) = 'ci_' ''').fetchall()
        assert tables
        assert all(name.startswith('ci_') for name, _ in tables), 'migrations created non-CI tables'
        assert all(enabled for _, enabled in tables), f'non-RLS table(s): {[n for n, e in tables if not e]}'
        assert conn.execute('SELECT count(*) FROM ci_workflows').fetchone()[0] == 0
        assert conn.execute('SELECT id FROM groundwork_guard').fetchone()[0] == 7
        assert conn.execute("SELECT has_table_privilege('authenticated', 'public.groundwork_guard', 'SELECT')").fetchone()[0] is True
        assert conn.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='companies'").fetchone()[0] == 0
