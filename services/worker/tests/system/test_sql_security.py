from pathlib import Path
import re


def test_every_public_table_is_rls_protected():
    migrations=sorted(Path('supabase/migrations').glob('*.sql'))
    sql='\n'.join(path.read_text() for path in migrations).lower()
    # Only public/unqualified tables are Data API exposure risks; private
    # schemas such as ci_langgraph must not be mistaken for a table called
    # "ci_langgraph" because the old regex stopped at the schema dot.
    def public_tables(pattern):
        found=re.findall(pattern,sql)
        return {table for schema,table in found if schema in ('','public')}
    tables=public_tables(r'create table if not exists\s+(?:([a-z_]+)\.)?([a-z_]+)')
    protected=public_tables(r'alter table\s+(?:([a-z_]+)\.)?([a-z_]+)\s+enable row level security')
    assert tables <= protected, f'RLS missing for {tables-protected}'


def test_outgoing_messages_require_unique_intent_keys():
    sql='\n'.join(p.read_text().lower() for p in Path('supabase/migrations').glob('*.sql'))
    assert 'outbound_messages' in sql
    assert 'intent_key text not null unique' in sql
