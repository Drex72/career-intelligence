"""Shared database isolation contract: all Career Intelligence SQL is prefixed."""
from pathlib import Path
from career.orchestration import postgres_ledger

ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS = sorted((ROOT / 'supabase' / 'migrations').glob('*.sql'))


def test_shared_database_migrations_only_create_ci_objects():
    import re
    assert len(MIGRATIONS) >= 7
    ddl = '\n'.join(p.read_text(encoding='utf8') for p in MIGRATIONS)
    assert 'revoke all on all tables in schema public' not in ddl.lower()
    for table in re.findall(r'create\s+table\s+if\s+not\s+exists\s+(\w+)', ddl, flags=re.I):
        assert table.startswith('ci_'), table
    for table in re.findall(r'alter\s+table\s+(\w+)\s+enable\s+row\s+level\s+security', ddl, flags=re.I):
        assert table.startswith('ci_'), table
    for table in re.findall(r'create\s+policy\s+(\w+)', ddl, flags=re.I):
        assert table.startswith('ci_'), table


def test_postgres_ledger_references_only_ci_tables():
    source = Path(postgres_ledger.__file__).read_text(encoding='utf8')
    for old_table in ('workflows','workflow_tasks','task_events','task_dependencies'):
        import re
        assert not re.search(r'(?<!ci_)\b'+old_table+r'\b', source), old_table
