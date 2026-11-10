"""Tests for secure draft-only outreach with a disposable PostgreSQL server."""
import os
from uuid import uuid4
from datetime import datetime,timezone
import pytest
pytestmark=pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='disposable PostgreSQL required')


def test_drafting_requires_approved_knowledge_and_matching_company(tmp_path):
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    from career.persistence.pg_knowledge import sync_vault
    from career.persistence.pg_outreach import prepare_pg_draft
    suffix=uuid4().hex[:12]; owner=uuid4()
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as c:
        job=c.upsert_job(source='ashby',source_job_id='draft-'+suffix,company_name='Draft Co '+suffix,
           company_domain='draft-'+suffix+'.example',title='Backend Engineer',
           apply_url='https://jobs.example.com/'+suffix,published_at=datetime.now(timezone.utc))
        c.assess_job(job,status='verified_eligible',source_url='https://jobs.example.com/'+suffix,
            excerpt='Remote applicants residing in Nigeria are eligible',confidence=.9)
        company=c.conn.execute('SELECT company_id FROM ci_jobs WHERE id=%s',(job,)).fetchone()['company_id']
        contact=c.add_contact(company,{'name':'Taylor Engineer','title':'Engineering Manager',
            'profile_url':'https://draft-'+suffix+'.example/team/taylor',
            'source':'https://draft-'+suffix+'.example/team'})
        sync_vault(c,tmp_path,git_sha=suffix)  # isolate approved notes from preceding tests
        with pytest.raises(ValueError,match='knowledge'):
            prepare_pg_draft(c,owner,job,contact)
        (tmp_path/'00-profile').mkdir()
        (tmp_path/'00-profile'/f'{suffix}.md').write_text('---\nstatus: approved\nvisibility: outreach-safe\n---\nI build backend APIs with PostgreSQL.\n')
        sync_vault(c,tmp_path,git_sha=suffix)
        id1=prepare_pg_draft(c,owner,job,contact)
        id2=prepare_pg_draft(c,owner,job,contact)
        assert id1==id2
        draft=c.conn.execute('SELECT status,subject,body FROM ci_outreach_drafts WHERE id=%s',(id1,)).fetchone()
        assert draft['status']=='draft'
        assert 'I build backend APIs' in draft['body']
        assert 'share a connection' not in draft['body']
        assert c.conn.execute('SELECT count(*) AS n FROM ci_outbound_messages WHERE draft_id=%s',(id1,)).fetchone()['n']==0
