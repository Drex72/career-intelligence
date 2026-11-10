"""Exercise the real compiled LangGraph when optional agent dependencies are installed."""
from uuid import uuid4
import pytest
from career.graph import AGENT_ROLES, build_agent_graph


@pytest.mark.parametrize('eligible,expected', [
    (True, ['discovery', 'eligibility', 'matching', 'people', 'outreach', 'conversation']),
    (False, ['discovery', 'eligibility']),
])
def test_real_agent_graph_routes_and_checkpoints(eligible, expected):
    pytest.importorskip('langgraph')
    from langgraph.checkpoint.memory import MemorySaver

    visited=[]
    def make_handler(role):
        def handler(state):
            visited.append(role)
            if role == 'eligibility':
                return {'eligibility': 'verified_eligible' if eligible else 'unknown'}
            if role == 'matching':
                return {'match_score': 88}
            return {'workflow_id': state.get('workflow_id', 'wf')}
        return handler

    saver=MemorySaver()
    graph=build_agent_graph({role:make_handler(role) for role in AGENT_ROLES}, saver)
    config={'configurable': {'thread_id': str(uuid4())}}
    result=graph.invoke({'workflow_id':'example'}, config)
    assert visited==expected
    assert result['eligibility']==('verified_eligible' if eligible else 'unknown')
    assert graph.get_state(config).values['eligibility']==result['eligibility']
