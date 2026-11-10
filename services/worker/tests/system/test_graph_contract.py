from career.graph import AGENT_ROLES, validate_handlers, route_after_eligibility


def test_all_six_agent_roles_registered():
    assert AGENT_ROLES==('discovery','eligibility','matching','people','outreach','conversation')


def test_eligibility_prevents_downstream_contact():
    assert route_after_eligibility({'eligibility':'ineligible'})=='end'
    assert route_after_eligibility({'eligibility':'unknown'})=='end'
    assert route_after_eligibility({'eligibility':'verified_eligible'})=='matching'


def test_missing_graph_handlers_rejected():
    try:validate_handlers({'discovery':lambda state:state})
    except ValueError as ex:assert 'eligibility' in str(ex)
    else:raise AssertionError('missing graph handlers were accepted')
