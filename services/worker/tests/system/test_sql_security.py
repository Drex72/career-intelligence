from pathlib import Path
import re


def test_every_public_table_is_rls_protected():
    migrations=sorted(Path('supabase/migrations').glob('*.sql'))
    sql='\n'.join(path.read_text() for path in migrations).lower()
    tables=set(re.findall(r'create table if not exists\s+([a-z_]+)',sql))
    protected=set(re.findall(r'alter table\s+([a-z_]+)\s+enable row level security',sql))
    assert tables <= protected, f'RLS missing for {tables-protected}'


def test_outgoing_messages_require_unique_intent_keys():
    sql='\n'.join(p.read_text().lower() for p in Path('supabase/migrations').glob('*.sql'))
    assert 'outbound_messages' in sql
    assert 'intent_key text not null unique' in sql
