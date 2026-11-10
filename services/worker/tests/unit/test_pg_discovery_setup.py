import pytest
from career.persistence.pg_discovery import parse_source_slug


def test_ats_source_id_rejects_injection():
    assert parse_source_slug('greenhouse','acme') == 'ats:greenhouse:acme'
    with pytest.raises(ValueError):
        parse_source_slug('greenhouse','../../internal')
    with pytest.raises(ValueError):
        parse_source_slug('internal','acme')
