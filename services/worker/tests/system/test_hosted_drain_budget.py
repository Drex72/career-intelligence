"""One-shot hosted runs drain role demand within a wall-clock budget and log only counts."""
from __future__ import annotations

import sys
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

pytest.importorskip("psycopg")
pytest.importorskip("langgraph.checkpoint.postgres")

import career.hosted_langgraph as hosted
from career.hosted_langgraph import (
    format_counts, made_progress, run_service, sanitized_counts, worker_handler,
)

ENDPOINT = "https://test-ref.supabase.co/functions/v1/ci-worker"
PROGRESS = {"status": "completed", "received": 20, "himalayas": 5, "reviewed": 2}
NO_PROGRESS = {"status": "completed", "received": 0, "reviewed": 0, "failures": 0}


def test_sanitized_counts_keeps_only_allowlisted_non_negative_integers():
    counts = sanitized_counts({
        "received": 12, "reviewed": -3, "matched": True, "himalayas": "7",
        "verified_eligible": 10**9, "title": "Staff Engineer", "private_notes": "x",
        "status": "completed",
    })
    assert counts == {"received": 12, "reviewed": 0, "verified_eligible": 1_000_000}


def test_progress_ignores_outcome_only_counts():
    assert made_progress({"reviewed": 1})
    assert not made_progress({"failures": 3, "verified_eligible": 0, "unknown": 0})
    assert format_counts({}) == "none"
    assert format_counts({"reviewed": 2, "failures": 0}) == "reviewed=2"


def test_handler_checkpoints_counts_but_no_response_text():
    client = Mock()
    client.post.return_value.json.return_value = {
        "status": "partial", "reviewed": 4, "failures": 1, "error_detail": "boom",
    }
    result = worker_handler("eligibility", ENDPOINT, "a" * 64, client)({"role": "eligibility"})
    assert result["observed"] == {"reviewed": 4, "failures": 1}
    assert "boom" not in repr(result)


class FakeClock:
    def __init__(self, call_seconds: float):
        self.now = 0.0
        self.call_seconds = call_seconds

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


@pytest.fixture
def harness(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake.example/test")
    monkeypatch.setenv("CI_WORKER_ENDPOINT", ENDPOINT)
    monkeypatch.setenv("CI_WORKER_SIGNING_KEY", "a" * 64)
    monkeypatch.setenv("CI_LANGGRAPH_ENABLED", "true")
    monkeypatch.setenv("CI_MAX_DISPATCH_PER_CYCLE", "1")
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))

    @contextmanager
    def fake_connect(*_args, **_kwargs):
        yield SimpleNamespace(rollback=lambda: None)

    @contextmanager
    def fake_saver(*_args, **_kwargs):
        yield SimpleNamespace(setup=lambda: None)

    import psycopg
    from langgraph.checkpoint.postgres import PostgresSaver
    monkeypatch.setattr(psycopg, "connect", fake_connect)
    monkeypatch.setattr(PostgresSaver, "from_conn_string", staticmethod(fake_saver))
    monkeypatch.setattr(hosted, "record_heartbeat", lambda *a, **k: None)

    state = SimpleNamespace(responses=[], demand=[], calls=0, summary=summary,
                            clock=FakeClock(call_seconds=40))
    monkeypatch.setattr(hosted.time, "monotonic", state.clock.monotonic)
    monkeypatch.setattr(hosted.time, "sleep", state.clock.sleep)

    def demand(_conn, role):
        queued = state.demand.pop(0) if state.demand else 5
        return {"role": role, "queued": queued, "active": 0, "desired": 2}
    monkeypatch.setattr(hosted, "role_demand", demand)

    def build(role, _handler, _saver):
        def invoke(_state, _config):
            state.calls += 1
            state.clock.now += state.clock.call_seconds
            output = state.responses.pop(0) if state.responses else PROGRESS
            return {"role": role, "status": output["status"],
                    "observed": sanitized_counts(output)}
        return SimpleNamespace(invoke=invoke)
    monkeypatch.setattr(hosted, "build_specialist_graph", build)
    return state


def test_budget_keeps_dispatching_until_worst_case_call_no_longer_fits(harness):
    run_service("discovery", once=True, interval=5, budget_seconds=200)
    # t=0→40, 45→85, 90→130, 135→175; then 175+40+5 > 200.
    assert harness.calls == 4
    text = harness.summary.read_text()
    assert "Signed dispatches: 4" in text
    assert "time budget reached" in text
    assert "- received: 80" in text and "- reviewed: 8" in text


def test_stops_when_a_call_makes_no_progress(harness):
    harness.responses = [PROGRESS, NO_PROGRESS, PROGRESS]
    run_service("discovery", once=True, interval=5, budget_seconds=3600)
    assert harness.calls == 2
    assert "last dispatch made no progress" in harness.summary.read_text()


def test_stops_when_role_demand_is_drained(harness):
    harness.demand = [3, 0]
    run_service("eligibility", once=True, interval=5, budget_seconds=3600)
    assert harness.calls == 1
    assert "no queued demand" in harness.summary.read_text()


def test_zero_budget_keeps_single_call_behaviour(harness):
    run_service("discovery", once=True, interval=5, budget_seconds=0)
    assert harness.calls == 1
    assert "single invocation" in harness.summary.read_text()


def test_failed_call_still_fails_the_job_and_records_reason(harness, monkeypatch):
    def build(role, _handler, _saver):
        def invoke(_state, _config):
            raise hosted.httpx.HTTPError("503")
        return SimpleNamespace(invoke=invoke)
    monkeypatch.setattr(hosted, "build_specialist_graph", build)
    with pytest.raises(hosted.httpx.HTTPError):
        run_service("discovery", once=True, interval=5, budget_seconds=360)
    assert "dispatch failed (HTTPError)" in harness.summary.read_text()


@pytest.mark.parametrize("budget", [-1, 30, 3601])
def test_invalid_budget_rejected_before_any_connection(harness, budget):
    with pytest.raises(ValueError, match="run budget"):
        run_service("discovery", once=True, interval=5, budget_seconds=budget)
    assert harness.calls == 0


def test_cli_reads_budget_from_environment(monkeypatch):
    seen = {}
    monkeypatch.setattr(hosted, "run_service", lambda role, **kw: seen.update(kw, role=role) or 0)
    monkeypatch.setenv("CI_RUN_BUDGET_SECONDS", "360")
    monkeypatch.setattr(sys, "argv", ["x"])
    assert hosted.main(["--role", "discovery", "--once"]) == 0
    assert seen["budget_seconds"] == 360 and seen["once"] is True
