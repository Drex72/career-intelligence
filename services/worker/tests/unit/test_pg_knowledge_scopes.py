from career.persistence.pg_knowledge import allowed_visibilities


def test_outreach_cannot_read_matching_only_notes():
    assert 'matching-safe' not in allowed_visibilities('outreach')
    assert 'outreach-safe' in allowed_visibilities('outreach')
    assert 'agents-safe' in allowed_visibilities('outreach')


def test_unknown_agent_gets_no_knowledge():
    assert allowed_visibilities('untrusted_tool')==()
