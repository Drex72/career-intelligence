"""Integration tests run only against the disposable PostgreSQL CI service."""
import os
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'), reason='disposable PostgreSQL test database required')


def test_postgres_catalog_records_evidence_and_delivers_each_company_once():
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    owner=uuid4()
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        company=str(uuid4())[:8]
        job=catalog.upsert_job(source='greenhouse',source_job_id='role-1-'+company,company_name='Firm '+company,
             company_domain='firm-'+company+'.example',title='Backend Engineer',
             apply_url='https://jobs.example.com/'+company+'/backend',
             published_at=datetime.now(timezone.utc)-timedelta(hours=2))
        assert catalog.upsert_job(source='greenhouse',source_job_id='role-1-'+company,
             company_name='Firm '+company,company_domain='firm-'+company+'.example',title='Backend Engineer',
             apply_url='https://jobs.example.com/'+company+'/backend',
             published_at=datetime.now(timezone.utc))==job
        assert catalog.create_batch(owner,date.today())==[]  # no verified evidence
        catalog.assess_job(job,status='verified_eligible',source_url='https://firm-'+company+'.example/careers',
                           excerpt='Open to international contractors',confidence=0.9)
        first=catalog.create_batch(owner,date.today())
        assert len(first)==1 and first[0]['job_id']==job
        assert catalog.create_batch(owner,date.today())==first
        assert catalog.create_batch(owner,date.today()+timedelta(days=1))==[]


def test_postgres_catalog_rejects_unsupported_verified_assessments():
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        token=str(uuid4())[:8]
        job=catalog.upsert_job(source='lever',source_job_id='role-'+token,company_name='Limited '+token,
             company_domain=None,title='Engineer',apply_url='https://jobs.lever.co/limited/'+token,
             published_at=datetime.now(timezone.utc))
        with pytest.raises(ValueError,match='evidence'):
            catalog.assess_job(job,status='verified_eligible',source_url=None,excerpt='',confidence=1.0)
        with pytest.raises(ValueError,match='confidence'):
            catalog.assess_job(job,status='unknown',source_url=None,excerpt='',confidence=1.2)
        assert catalog.create_batch(uuid4(),date.today())==[]


def test_postgres_batch_rejects_stale_or_unpublished_jobs():
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    owner=uuid4()
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        token=uuid4().hex[:10]
        job=catalog.upsert_job(source='greenhouse',source_job_id='stale-'+token,
            company_name='Stale Firm '+token,company_domain='stale-'+token+'.example',
            title='Backend Engineer',apply_url='https://stale.example/jobs/'+token,
            published_at=datetime.now(timezone.utc)-timedelta(days=10))
        catalog.assess_job(job,status='verified_eligible',source_url='https://stale.example/jobs/'+token,
                           excerpt='Remote applicants residing in Nigeria are eligible',confidence=0.9)
        assert catalog.create_batch(owner,date.today())==[]
