"""Durable discovery-source registry scoped to the ci_ namespace."""
from __future__ import annotations
import json
import re

PROVIDERS = frozenset({'ashby','greenhouse','lever'})


def parse_source_slug(provider: str, slug: str) -> str:
    if provider not in PROVIDERS or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',slug):
        raise ValueError('invalid ATS source identifier')
    return f'ats:{provider}:{slug}'


def register_board(catalog, provider: str, slug: str, company_name: str,
                   company_domain: str | None = None) -> str:
    name = parse_source_slug(provider, slug)
    if not company_name.strip() or len(company_name)>300:
        raise ValueError('valid company name required')
    from career.persistence.postgres_catalog import normalize_domain
    domain = normalize_domain(company_domain)
    data = json.dumps({'provider':provider,'slug':slug,'company_name':company_name,'domain':domain})
    with catalog.conn.transaction():
        catalog.conn.execute('''INSERT INTO ci_discovery_sources(name,kind,discovery_method,config)
            VALUES (%s,'ats','feed_expansion',%s::jsonb)
            ON CONFLICT(name) DO UPDATE SET
                 config=excluded.config WHERE ci_discovery_sources.state='active' ''', (name,data))
    return name


def list_boards(catalog, *, limit: int = 10) -> list[dict]:
    if not 1<=limit<=100:
        raise ValueError('board limit must be 1..100')
    rows=catalog.conn.execute('''SELECT config FROM ci_discovery_sources
          WHERE kind='ats' AND state='active' ORDER BY first_discovered_at ASC LIMIT %s''',(limit,)).fetchall()
    result=[]
    for row in rows:
        config=row['config']
        if not isinstance(config,dict):
            continue
        try:
            parse_source_slug(config['provider'],config['slug'])
            if not config.get('company_name'):
                continue
            result.append(config)
        except (KeyError,ValueError):
            continue
    return result
