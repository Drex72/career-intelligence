"""Require isolated PostgreSQL and pre-applied migrations."""
import os
from uuid import uuid4
import pytest
pytestmark=pytest.mark.skipif(not os.environ.get('PG_TEST_DSN'),reason='isolated PostgreSQL required')


def test_board_registration_is_idempotent_and_bounded():
    from career.persistence.postgres_catalog import PostgresCareerCatalog
    from career.persistence.pg_discovery import register_board,list_boards
    with PostgresCareerCatalog(os.environ['PG_TEST_DSN']) as catalog:
        slug='employer'+uuid4().hex[:8]
        register_board(catalog,'greenhouse',slug,'Employer '+slug,'employer.example')
        register_board(catalog,'greenhouse',slug,'Employer '+slug,'employer.example')
        boards=[b for b in list_boards(catalog,limit=50) if b['slug']==slug]
        assert len(boards)==1
        assert boards[0]['provider']=='greenhouse'
        assert boards[0]['company_name']=='Employer '+slug
