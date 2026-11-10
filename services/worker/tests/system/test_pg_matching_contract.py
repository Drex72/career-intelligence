"""Unit checks for matching without database secrets."""
import pytest
from career.persistence.pg_matching import rank_verified_jobs

class EmptyKnowledgeCatalog:
    def __init__(self):self.conn=object()


def test_missing_approved_knowledge_does_not_create_fabricated_match(monkeypatch):
    monkeypatch.setattr('career.persistence.pg_matching.retrieve_knowledge',lambda catalog,agent_role: '')
    assert rank_verified_jobs(EmptyKnowledgeCatalog())=={'ranked':0,'reason':'no approved matching knowledge'}


def test_invalid_limit_rejected_before_database_use():
    with pytest.raises(ValueError,match='limit'):
        rank_verified_jobs(EmptyKnowledgeCatalog(),limit=501)
