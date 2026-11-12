"""Hosted LangGraph contracts: real graph, role signing and safe default-off rollout."""
from __future__ import annotations

import hashlib
import hmac
from unittest.mock import Mock
from uuid import UUID

import pytest

from career.graph import AGENT_ROLES
from career.hosted_langgraph import (
    build_specialist_graph, validate_endpoint, signed_role_payload,
    worker_handler, run_service, checkpoint_dsn
)

def test_six_roles_are_independent_and_explicit():
    assert AGENT_ROLES == ('discovery','eligibility','matching','people','outreach','conversation')

@pytest.mark.parametrize('role', AGENT_ROLES)
def test_role_signature_is_fresh_and_cannot_be_substituted(role):
    token = signed_role_payload(role, 'a' * 64, now=1794480000)
    UUID(token['nonce'])
    assert token['role'] == role
    assert token['timestamp'] == 1794480000
    message = f"{token['nonce']}:{token['timestamp']}:{role}".encode()
    assert hmac.compare_digest(
        token['signature'], hmac.new(b'a' * 64, message, hashlib.sha256).hexdigest()
    )
    alternate = next(x for x in AGENT_ROLES if x != role)
    assert token['signature'] != hmac.new(
        b'a' * 64, f"{token['nonce']}:{token['timestamp']}:{alternate}".encode(),
        hashlib.sha256
    ).hexdigest()

def test_invalid_secret_and_roles_fail_closed():
    with pytest.raises(ValueError):
        signed_role_payload('gmail_send', 'a' * 64)
    with pytest.raises(ValueError):
        signed_role_payload('people', 'bad')

@pytest.mark.parametrize('value', [
    'http://example.com/functions/v1/ci-worker',
    'https://evil.example.org/functions/v1/ci-worker',
    'https://foo.supabase.co.evil.com/functions/v1/ci-worker',
    'https://username@foo.supabase.co/functions/v1/ci-worker',
    'https://foo.supabase.co:123/functions/v1/ci-worker',
    'https://foo.supabase.co/functions/v1/ci-api',
    'https://foo.supabase.co/functions/v1/ci-worker?token=1'
])
def test_worker_endpoint_rejects_non_supabase_or_privileged_paths(value):
    with pytest.raises(ValueError):
        validate_endpoint(value)

def test_supabase_worker_endpoint_allowed():
    assert validate_endpoint('https://test-ref.supabase.co/functions/v1/ci-worker')

def test_role_graph_compiles_and_isolated():
    pytest.importorskip('langgraph')
    from langgraph.checkpoint.memory import MemorySaver
    for role in AGENT_ROLES:
        events = []
        def handler(state):
            events.append(role)
            return {'role': role, 'status': 'completed'}
        graph = build_specialist_graph(role, handler, MemorySaver())
        result = graph.invoke({'role':role}, {'configurable': {'thread_id':role+'-test'}})
        assert result['role'] == role
        assert events == [role]

def test_handler_executes_role_bounded_signed_request_without_credentials_in_checkpoint():
    client = Mock()
    client.post.return_value.json.return_value = {'status':'completed','private_notes':'secret'}
    role = 'matching'
    handler = worker_handler(role,
        'https://test-ref.supabase.co/functions/v1/ci-worker','a' * 64,client)
    result = handler({'role':role})
    assert result['status'] == 'completed'
    assert result['dispatched'] is True
    assert 'private_notes' not in result
    payload = client.post.call_args.kwargs['json']
    assert payload['role'] == role
    assert set(payload) == {'nonce','timestamp','signature','role'}

def test_default_off_rejects_active_start_before_any_network(monkeypatch):
    monkeypatch.setenv('DATABASE_URL','postgresql://fake.example/test')
    monkeypatch.setenv('CI_WORKER_ENDPOINT','https://test-ref.supabase.co/functions/v1/ci-worker')
    monkeypatch.delenv('CI_LANGGRAPH_ENABLED',raising=False)
    with pytest.raises(RuntimeError,match='CI_LANGGRAPH_ENABLED'):
        run_service('discovery',once=True)
