"""Read-only discovery-to-delivery funnel snapshot.

Prints aggregate counts only: no job titles, URLs, owner identifiers, evidence
excerpts or note bodies. GitHub Actions logs of this public repository are
publicly readable, so every query below must return counts or fixed reason
codes. The session is forced read-only at connection time.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Callable

SECTIONS: list[tuple[str, str]] = [
    ("Discovery sources by kind and state", """
        select kind, state, count(*) as n from ci_discovery_sources
        group by 1,2 order by 1,2"""),
    ("Jobs by status", """
        select status, count(*) as n,
          count(*) filter (where first_seen_at>now()-interval '24 hours') as new_24h,
          count(*) filter (where first_seen_at>now()-interval '7 days') as new_7d
        from ci_jobs group by 1 order by 1"""),
    ("Job sources (last 7 days, by provider)", """
        select s.source_name, count(distinct s.job_id) as jobs
        from ci_job_sources s join ci_jobs j on j.id=s.job_id
        where j.first_seen_at>now()-interval '7 days'
        group by 1 order by 2 desc"""),
    ("Open jobs by publication age", """
        select case
            when published_at is null then 'unknown'
            when published_at>now()-interval '72 hours' then '<72h'
            when published_at>now()-interval '7 days' then '3-7d'
            else '>7d' end as age, count(*) as n
        from ci_jobs where status='open' group by 1 order by 1"""),
    ("Eligibility review queue", """
        select state, count(*) as n from ci_eligibility_review_queue group by 1 order by 1"""),
    ("Latest eligibility per job (status, reason code)", """
        with latest as (
          select distinct on (a.job_id) a.job_id, a.status, a.reasons->>0 as reason,
            a.policy_version, (a.expires_at is null or a.expires_at>now()) as current
          from ci_eligibility_assessments a order by a.job_id, a.assessed_at desc, a.id desc)
        select status, policy_version, current, left(coalesce(reason,'(none)'),90) as reason, count(*) as n
        from latest group by 1,2,3,4 order by n desc limit 25"""),
    ("Job remote-scope evidence (unexpired)", """
        select scope, count(*) as n from ci_job_remote_scope_evidence
        where expires_at>now() group by 1 order by 1"""),
    ("Company country evidence", """
        select country, count(*) as n from ci_company_country_evidence group by 1 order by 2 desc limit 10"""),
    ("Matches", """
        select count(*) as matches, count(distinct job_id) as jobs,
          count(*) filter (where score=0) as score_zero,
          round(avg(score)) as avg_score from ci_job_matches"""),
    ("Owner discovery preferences", """
        select daily_target, job_families, seniority_levels, work_modes, sponsorship
        from ci_discovery_preferences"""),
    ("Geo target configured", """
        select count(*) as owners_with_geo_target from ci_geo_target_preferences"""),
    ("Delivery gate, step by step (open jobs)", """
        with o as (select owner_user_id from ci_discovery_preferences limit 1),
        latest as (
          select distinct on (a.job_id) a.job_id, a.status, a.expires_at
          from ci_eligibility_assessments a order by a.job_id, a.assessed_at desc, a.id desc),
        j as (select j.* from ci_jobs j where j.status='open'),
        s1 as (select j.* from j join latest l on l.job_id=j.id
               where l.status='verified_eligible' and (l.expires_at is null or l.expires_at>now())),
        s2 as (select * from s1 where published_at>=now()-interval '7 days'),
        s3 as (select * from s2 where exists (select 1 from ci_eligibility_evidence e where e.job_id=s2.id)),
        s4 as (select s3.* from s3, o where ci_job_matches_preferences(s3.id, o.owner_user_id)),
        s5 as (select s4.* from s4, o where ci_job_matches_geo_target(s4.id, o.owner_user_id)),
        s6 as (select s5.* from s5, o where not exists (
                 select 1 from ci_delivered_jobs d where d.owner_user_id=o.owner_user_id and d.job_id=s5.id))
        select (select count(*) from j) as open_jobs,
          (select count(*) from s1) as verified_current,
          (select count(*) from s2) as published_7d,
          (select count(*) from s3) as with_evidence,
          (select count(*) from s4) as matches_preferences,
          (select count(*) from s5) as matches_geo_target,
          (select count(*) from s6) as not_yet_delivered"""),
    ("Verified jobs failing the geo target, by missing evidence", """
        with latest as (
          select distinct on (a.job_id) a.job_id, a.status, a.expires_at
          from ci_eligibility_assessments a order by a.job_id, a.assessed_at desc, a.id desc)
        select
          count(*) as verified_open,
          count(*) filter (where not exists (select 1 from ci_company_country_evidence c
              where c.company_id=j.company_id and c.country='US')) as no_us_employer_evidence,
          count(*) filter (where not exists (select 1 from ci_job_remote_scope_evidence r
              where r.job_id=j.id and r.scope='worldwide' and r.expires_at>now())) as no_worldwide_evidence
        from ci_jobs j join latest l on l.job_id=j.id
        where j.status='open' and l.status='verified_eligible'
          and (l.expires_at is null or l.expires_at>now())"""),
    ("Daily batches (last 7 days)", """
        select b.local_date, b.target, b.state, count(i.id) as delivered
        from ci_daily_batches b left join ci_daily_batch_items i on i.batch_id=b.id
        where b.local_date>=current_date-7 group by 1,2,3 order by 1 desc"""),
    ("Worker runs (last 24h)", """
        select coalesce(details->>'role', '(none)') as role, state, count(*) as runs,
          sum(coalesce((details->>'received')::int,0)) as received,
          sum(coalesce((details->>'normalized')::int,0)) as normalized,
          sum(coalesce((details->>'rejected_role')::int,0)) as rejected_role,
          sum(coalesce((details->>'rejected_stale')::int,0)) as rejected_stale,
          sum(coalesce((details->>'boards_scanned')::int,0)) as boards_scanned,
          sum(coalesce((details->>'reviewed')::int,0)) as reviewed,
          sum(coalesce((details->>'verified_eligible')::int,0)) as verified,
          sum(coalesce((details->>'likely_eligible')::int,0)) as likely,
          sum(coalesce((details->>'unknown')::int,0)) as unknown,
          sum(coalesce((details->>'ineligible')::int,0)) as ineligible,
          sum(coalesce((details->>'failures')::int,0)) as failures
        from ci_worker_runs where started_at>now()-interval '24 hours'
        group by 1,2 order by 1,2"""),
    ("Pipeline events (last 7 days, by stage, agent and event)", """
        select stage, agent, event_type, count(*) as n from ci_pipeline_events
        where occurred_at>now()-interval '7 days'
        group by 1,2,3 order by n desc limit 25"""),
]

_MAX_CELL = 90


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = ",".join(str(v) for v in value)
    text = str(value).replace("|", "/").replace("\n", " ")
    return text[:_MAX_CELL]


def render(title: str, columns: list[str], rows: list[tuple]) -> str:
    out = [f"### {title}", ""]
    if not rows:
        return "\n".join(out + ["_no rows_", ""])
    out.append("| " + " | ".join(columns) + " |")
    out.append("|" + "---|" * len(columns))
    for row in rows:
        out.append("| " + " | ".join(_cell(v) for v in row) + " |")
    return "\n".join(out + [""])


def build_report(execute: Callable[[str], tuple[list[str], list[tuple]]]) -> str:
    parts = ["## Career Intelligence funnel snapshot", ""]
    for title, sql in SECTIONS:
        try:
            columns, rows = execute(sql)
            parts.append(render(title, columns, rows))
        except Exception as exc:  # one missing table must not hide the rest
            parts.append(f"### {title}\n\n_unavailable: {type(exc).__name__}_\n")
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only funnel snapshot")
    parser.parse_args(argv)
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    import psycopg

    # Every query runs in its own BEGIN READ ONLY transaction that is rolled
    # back, which also works through Supabase's transaction pooler.
    with psycopg.connect(db_url) as conn:
        conn.read_only = True

        def execute(sql: str):
            try:
                with conn.cursor() as cur:
                    cur.execute("set local statement_timeout = 20000")
                    cur.execute(sql)
                    cols = [d.name for d in cur.description or []]
                    return cols, cur.fetchall()
            finally:
                conn.rollback()
        report = build_report(execute)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(report + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
