"""Official employer ATS links may enter review queue; never auto-activate or prove hiring eligibility."""
import os
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'), reason='isolated PostgreSQL required')
def test_official_ats_evidence_is_provider_and_board_scoped():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        suffix=uuid4().hex[:10]
        cases=[
            ('greenhouse','canonical'+suffix,f'https://job-boards.greenhouse.io/canonical{suffix}/jobs/6768925'),
            ('lever','soum'+suffix,f'https://jobs.lever.co/soum{suffix}/d92500f9-6ba1-4c98-8ef5-849dd4f1e4f4'),
            ('ashby','numo'+suffix,f'https://jobs.ashbyhq.com/numo{suffix}/fb67cd83-29e3-4fbf-886d-3d0f6f31224b'),
        ]
        for provider,slug,url in cases:
            assert db.execute("select ci_suggest_ats_board(%s,%s,%s,%s)",(provider,slug,'Test '+slug,url)).fetchone()[0] is True
            row=db.execute("select state,source_kind from ci_ats_source_candidates where provider=%s and board_slug=%s",(provider,slug)).fetchone()
            assert row==('pending','official_ats')
            assert db.execute("select ci_suggest_ats_board(%s,%s,%s,%s)",(provider,slug,'Test '+slug,url)).fetchone()[0] is False
            assert db.execute("select count(*) from ci_discovery_sources where name=%s",('ats:'+provider+':'+slug,)).fetchone()[0]==0
            for bad in (
                url.replace(slug,'unrelated-company'),
                url.replace('https://','http://'),
                url+'?evil=1',
                'https://untrusted.example/'+slug+'/jobs/6768925'
            ):
                other=slug+'z'
                assert db.execute("select ci_suggest_ats_board(%s,%s,%s,%s)",(provider,other,'Test '+other,bad)).fetchone()[0] is False

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'), reason='isolated PostgreSQL required')
def test_official_source_suggestion_not_executable_by_browser():
    import psycopg
    with psycopg.connect(os.environ['PG_TEST_DSN']) as db:
        for role in ('anon','authenticated'):
            assert db.execute("select has_function_privilege(%s,'ci_suggest_ats_board(text,text,text,text)','EXECUTE')",(role,)).fetchone()[0] is False
