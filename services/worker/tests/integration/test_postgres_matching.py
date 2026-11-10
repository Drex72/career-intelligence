"""Rank only eligible roles using the approved visibility-filtered knowledge snapshot."""
import os
from datetime import datetime, timezone
from uuid import uuid4
import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='disposable PostgreSQL required')


def test_postgres_matching_uses_approved_revision_and_is_idempotent(tmp_path):
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    from career.persistence.pg_knowledge import sync_vault
    from career.persistence.pg_matching import rank_verified_jobs

    suffix = uuid4().hex[:10]
    (tmp_path / '00-profile').mkdir()
    (tmp_path / '00-profile' / f'{suffix}.md').write_text(
        '---\nstatus: approved\nvisibility: matching-safe\n---\nI build Python and PostgreSQL backend systems.\n', encoding='utf8')
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        sync_vault(catalog, tmp_path, git_sha=suffix)
        job = catalog.upsert_job(source='greenhouse', source_job_id='match-'+suffix,
            company_name='Matching Test '+suffix, company_domain='match-'+suffix+'.example',
            title='Python PostgreSQL Backend Engineer',
            apply_url='https://jobs.example.com/matching/'+suffix, published_at=datetime.now(timezone.utc))
        catalog.assess_job(job,status='verified_eligible',source_url='https://jobs.example.com/matching/'+suffix,
                           excerpt='Remote applicants residing in Nigeria are eligible',confidence=.9)
        first=rank_verified_jobs(catalog, job_ids=[job])
        second=rank_verified_jobs(catalog, job_ids=[job])
        assert first['ranked']==1 and second['ranked']==1
        row=catalog.conn.execute('SELECT score,matched,gaps FROM ci_job_matches WHERE job_id=%s',(job,)).fetchone()
        assert row['score']==100
        assert 'python' in row['matched'] and 'postgresql' in row['matched']
        assert catalog.conn.execute('SELECT count(*) AS n FROM ci_job_matches WHERE job_id=%s',(job,)).fetchone()['n']==1


def test_unverified_job_cannot_be_ranked(tmp_path):
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    from career.persistence.pg_matching import rank_verified_jobs
    suffix=uuid4().hex[:10]
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        job=catalog.upsert_job(source='lever',source_job_id='unverified-'+suffix,
            company_name='Unverified '+suffix,company_domain='unverified-'+suffix+'.example',
            title='Python Engineer',apply_url='https://jobs.example.com/unverified/'+suffix,
            published_at=datetime.now(timezone.utc))
        assert rank_verified_jobs(catalog,job_ids=[job])['ranked']==0
        assert catalog.conn.execute('SELECT count(*) AS n FROM ci_job_matches WHERE job_id=%s',(job,)).fetchone()['n']==0
