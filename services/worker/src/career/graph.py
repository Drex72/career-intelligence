"""Six-role LangGraph workflow registration and validation.

LangGraph is an optional runtime dependency. Install the `agents` extra to
compile/run this graph with a persistent PostgreSQL checkpointer.
"""
from typing import Callable, TypedDict, Any

AGENT_ROLES=('discovery','eligibility','matching','people','outreach','conversation')

class AgentState(TypedDict, total=False):
    workflow_id: str
    job_id: str
    company_id: str
    eligibility: str
    match_score: int
    contact_ids: list[str]
    draft_ids: list[str]
    conversation_state: str
    error: str


def validate_handlers(handlers:dict[str,Callable[[AgentState],dict]])->None:
    missing=[name for name in AGENT_ROLES if name not in handlers or not callable(handlers[name])]
    if missing: raise ValueError('missing agent handlers: '+', '.join(missing))


def route_after_eligibility(state:AgentState)->str:
    return 'matching' if state.get('eligibility')=='verified_eligible' else 'end'


def build_agent_graph(handlers:dict[str,Callable],checkpointer:Any):
    """Compile an actual LangGraph with 6 specialists and bounded conditional routes.

    The graph itself never sends email. Handlers may only create drafts;
    dispatch is managed by a separate deterministic authorized service.
    """
    validate_handlers(handlers)
    try:
        from langgraph.graph import StateGraph,START,END
    except ImportError as error:
        raise RuntimeError('Install langgraph to compile the multi-agent graph') from error
    graph=StateGraph(AgentState)
    for role in AGENT_ROLES: graph.add_node(role,handlers[role])
    graph.add_edge(START,'discovery')
    graph.add_edge('discovery','eligibility')
    graph.add_conditional_edges('eligibility',route_after_eligibility,{'matching':'matching','end':END})
    graph.add_edge('matching','people')
    graph.add_edge('people','outreach')
    graph.add_edge('outreach','conversation')
    graph.add_edge('conversation',END)
    return graph.compile(checkpointer=checkpointer)
