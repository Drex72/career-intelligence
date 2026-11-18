"""Funnel snapshot is aggregate-only and resilient to missing objects."""
from __future__ import annotations

import re

from career.funnel_report import SECTIONS, build_report, main, render

FORBIDDEN_COLUMNS = re.compile(
    r"\b(title|apply_url|canonical_apply_url|source_url|excerpt|body|owner_user_id|"
    r"legal_name|email|description)\b\s*(,|from|$)", re.I
)


def _select_list(sql: str) -> str:
    # Final top-level select list (after any CTEs).
    last = sql.lower().rsplit("select", 1)[-1]
    return last.split(" from ", 1)[0]


def test_every_section_selects_only_aggregates_or_codes():
    for title, sql in SECTIONS:
        selected = _select_list(sql)
        assert not FORBIDDEN_COLUMNS.search(selected), title


def test_every_query_is_read_only():
    for title, sql in SECTIONS:
        lowered = sql.lower()
        for verb in ("insert ", "update ", "delete ", "truncate ", "alter ", "drop ", "grant "):
            assert verb not in lowered, (title, verb)


def test_failures_in_one_section_do_not_hide_others():
    calls = []

    def execute(sql):
        calls.append(sql)
        if len(calls) == 2:
            raise RuntimeError("relation does not exist")
        return ["n"], [(3,)]

    report = build_report(execute)
    assert len(calls) == len(SECTIONS)
    assert "_unavailable: RuntimeError_" in report
    assert report.count("| 3 |") == len(SECTIONS) - 1


def test_render_truncates_and_escapes_cells():
    out = render("t", ["a"], [("x|y\n" + "z" * 200,)])
    row = out.splitlines()[-1]
    assert "x/y z" in row and len(row) < 120


def test_requires_database_url(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert main([]) == 2
