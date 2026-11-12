"""Persistent role-scoped Python LangGraph service.

Run the same container as SIX separate background services, one per role.
This runtime checkpoints actual LangGraph invocations in its own PostgreSQL
schema and delegates bounded specialist execution to the existing, signed
Supabase Edge worker. It does NOT reimplement the production eligibility gate,
send Gmail messages, or pretend to host six independent LLMs.

Activation is deliberately off by default. The legacy pg_cron orchestrator must
be disabled at cutover so both schedulers cannot compete for the same work.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import os
import signal
import time
from datetime import datetime, timezone
from typing import TypedDict
from urllib.parse import urlparse
from uuid import uuid4

import httpx

from career.graph import AGENT_ROLES

LOGGER = logging.getLogger("career.langgraph.hosted")


class HostedState(TypedDict, total=False):
    role: str
    dispatched: bool
    status: str
    timestamp: str
    observed: dict[str, int]


def validate_endpoint(url: str) -> str:
    parsed = urlparse(url)
    if (
        parsed.scheme != "https" or
        not parsed.hostname or
        not parsed.hostname.endswith(".supabase.co") or
        parsed.username or parsed.password or parsed.port or
        parsed.path.rstrip("/") != "/functions/v1/ci-worker" or
        parsed.query or parsed.fragment
    ):
        raise ValueError("CI_WORKER_ENDPOINT must be the approved Supabase ci-worker URL")
    return url


def signed_role_payload(role: str, secret: str, now: int | None = None) -> dict:
    if role not in AGENT_ROLES:
        raise ValueError("unrecognized specialist role")
    if not secret or len(secret) < 32:
        raise ValueError("CI_WORKER_SIGNING_KEY is missing or too short")
    tick = int(time.time() if now is None else now)
    nonce = str(uuid4())
    message = f"{nonce}:{tick}:{role}".encode()
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return {"nonce": nonce, "timestamp": tick, "signature": signature, "role": role}


def worker_handler(role: str, endpoint: str, secret: str, client: httpx.Client):
    """One LangGraph node per hosted service; authenticated task execution is delegated.

    Edge worker owns the existing atomic ATS / review claims, so running both
    runtimes against the same queues remains idempotent, but two *schedulers*
    should not deliberately duplicate dispatch.
    """
    def run(state: HostedState) -> HostedState:
        payload = signed_role_payload(role, secret)
        response = client.post(endpoint, json=payload, timeout=90)
        response.raise_for_status()
        output = response.json()
        if not isinstance(output, dict):
            raise RuntimeError("invalid signed worker response")
        # Keep the checkpoint strictly scalar: no descriptions or credentials.
        return {
            "role": role,
            "dispatched": True,
            "status": str(output.get("status", "completed"))[:32],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    return run


def build_specialist_graph(role: str, handler, checkpointer):
    """Compile the real LangGraph installed in the Python service.

    These are six different *deployed single-specialist graphs*, not six nodes
    secretly executed by one shared Python process. The existing cross-stage
    pipeline graph remains available for orchestration tests.
    """
    if role not in AGENT_ROLES:
        raise ValueError("invalid specialist")
    from langgraph.graph import StateGraph, START, END
    graph = StateGraph(HostedState)
    graph.add_node(role, handler)
    graph.add_edge(START, role)
    graph.add_edge(role, END)
    return graph.compile(checkpointer=checkpointer)


def role_demand(conn, role: str) -> dict:
    row = conn.execute(
        "select public.ci_specialist_pool_plan() as result"
    ).fetchone()
    plan = row["result"]
    return next((r for r in plan.get("roles", []) if r.get("role") == role), {
        "role": role, "queued": 0, "active": 0, "desired": 0, "spawn": 0
    })


def checkpoint_dsn(database_url: str) -> str:
    # langgraph-checkpoint-postgres creates unqualified checkpoint tables.
    # Use a dedicated schema instead of polluting public / ci_ application tables.
    from psycopg.conninfo import make_conninfo
    return make_conninfo(database_url, options="-c search_path=ci_langgraph,public")


def require_no_parallel_scheduler(conn) -> None:
    """Fail closed when GitHub Actions could race the existing Supabase cron.

    Call for every live one-shot invocation (not only at workflow planning time).
    If cron metadata is inaccessible, abort rather than assume it is safe.
    """
    if conn.execute("select to_regclass('cron.job') as present").fetchone()['present'] is None:
        raise RuntimeError("Cannot verify Supabase scheduler is disabled")
    active=conn.execute(
        """select count(*) as n from cron.job
          where active and jobname in (
            'ci-role-aware-specialist-pool-15m',
            'ci-adaptive-worker-pool-15m',
            'ci-unattended-public-research-6h'
          )"""
    ).fetchone()['n']
    if active:
        raise RuntimeError("Old Supabase specialist scheduler is active; refusing dual dispatch")


def record_heartbeat(conn, role: str, instance_id: str, status: str) -> None:
    with conn.transaction():
        conn.execute(
            """insert into ci_langgraph.runtime_processes
              (instance_id,role,state,last_heartbeat_at)
              values (%s,%s,%s,now())
              on conflict(instance_id) do update
              set state=excluded.state,
                  last_heartbeat_at=excluded.last_heartbeat_at""",
            (instance_id, role, status),
        )


def run_service(
    role: str,
    *,
    once: bool = False,
    dry_run: bool = False,
    interval: float = 30.0,
    max_cycles: int = 0,
) -> int:
    if role not in AGENT_ROLES:
        raise ValueError("CI_SPECIALIST_ROLE must identify one of six specialists")
    if not 5 <= interval <= 3600:
        raise ValueError("poll interval must be 5–3600 seconds")
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise RuntimeError("DATABASE_URL is required")
    active = os.environ.get("CI_LANGGRAPH_ENABLED", "false").lower() == "true"
    if not dry_run and not active:
        raise RuntimeError("CI_LANGGRAPH_ENABLED is false; enable only after scheduler cutover")
    endpoint = validate_endpoint(os.environ.get("CI_WORKER_ENDPOINT", ""))
    secret = os.environ.get("CI_WORKER_SIGNING_KEY", "")
    if not dry_run and len(secret) < 32:
        raise RuntimeError("CI_WORKER_SIGNING_KEY is required for active execution")

    import psycopg
    from psycopg.rows import dict_row
    from langgraph.checkpoint.postgres import PostgresSaver

    # Never load arbitrary Python objects from untrusted checkpoint records.
    os.environ["LANGGRAPH_STRICT_MSGPACK"] = "true"
    instance_id = str(uuid4())
    shutdown = False

    def stop(*_):
        nonlocal shutdown
        shutdown = True

    # Host sends SIGTERM on deploy/scale-down. We stop after the current graph run.
    try:
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
    except ValueError:
        pass  # signal handlers must be registered from the main thread

    with psycopg.connect(db_url, row_factory=dict_row, autocommit=True) as conn:
        if active and os.getenv("CI_REQUIRE_CRON_DISABLED","false").lower()=="true":
            require_no_parallel_scheduler(conn)
        with PostgresSaver.from_conn_string(checkpoint_dsn(db_url)) as saver:
            saver.setup()
            with httpx.Client(follow_redirects=False) as client:
                graph = build_specialist_graph(
                    role, worker_handler(role, endpoint, secret, client), saver
                )
                try:
                    record_heartbeat(conn, role, instance_id, "starting")
                    cycle = 0
                    while not shutdown:
                        cycle += 1
                        try:
                            record_heartbeat(conn, role, instance_id, "polling")
                            lane = role_demand(conn, role)
                            ready = int(lane.get("queued", 0))
                            active_count = int(lane.get("active", 0))
                            desired = int(lane.get("desired", 0))
                            capacity = max(0, desired - active_count)
                            cycle_budget = max(1, min(32, int(os.getenv("CI_MAX_DISPATCH_PER_CYCLE", "8"))))
                            dispatch_count = min(capacity, cycle_budget) if ready and not dry_run else 0
                            if dispatch_count:
                                record_heartbeat(conn, role, instance_id, "executing")
                                for _ in range(dispatch_count):
                                    if shutdown:
                                        break
                                    thread = str(uuid4())
                                    result = graph.invoke(
                                        {"role": role}, {"configurable": {"thread_id": thread}}
                                    )
                                    LOGGER.info("specialist=%s state=%s", role, result.get("status"))
                            else:
                                LOGGER.info(
                                    "specialist=%s idle queued=%d active=%d desired=%d dry_run=%s",
                                    role, ready, active_count, desired, dry_run
                                )
                        except (psycopg.Error, httpx.HTTPError, RuntimeError, ValueError) as exc:
                            LOGGER.warning(
                                "specialist=%s cycle_failed=%s",
                                role, type(exc).__name__
                            )
                            conn.rollback()
                            if once:
                                raise
                        if once or (max_cycles and cycle >= max_cycles):
                            break
                        time.sleep(interval)
                finally:
                    record_heartbeat(conn, role, instance_id, "stopped")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="One role-scoped hosted LangGraph service")
    parser.add_argument(
        "--role",
        choices=AGENT_ROLES,
        default=os.environ.get("CI_SPECIALIST_ROLE"),
        required=False,
    )
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--interval", type=float, default=float(os.getenv("CI_POLL_SECONDS", "30")))
    args = parser.parse_args(argv)
    if not args.role:
        parser.error("set CI_SPECIALIST_ROLE or supply --role")
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    return run_service(
        args.role, once=args.once, dry_run=args.dry_run, interval=args.interval
    )


if __name__ == "__main__":
    raise SystemExit(main())
