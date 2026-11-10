"""The opt-in Obsidian validator must run without any PostgreSQL access."""
import json
import os
import subprocess
import sys


def test_pg_vault_dry_run_is_offline(tmp_path):
    vault = tmp_path / "vault"
    note = vault / "03-skills" / "backend.md"
    note.parent.mkdir(parents=True)
    note.write_text("---\nstatus: approved\nvisibility: matching-safe\n---\n# Backend\nVerified technical skills.\n", encoding="utf-8")
    env = dict(os.environ)
    env["DATABASE_URL"] = "postgresql://invalid:invalid@[::1]:6543/postgres"
    result = subprocess.run(
        [sys.executable, "-m", "career.cli", "pg-vault-sync", str(vault), "--dry-run"],
        env=env, capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "dry_run": True,
        "approved": 1,
        "skipped": 0,
        "database_modified": False,
    }


def test_pg_vault_dry_run_pending_notes_not_indexed(tmp_path):
    note = tmp_path / "00-profile" / "about-me.md"
    note.parent.mkdir(parents=True)
    note.write_text("---\nstatus: pending\nvisibility: agents-safe\n---\n# Not approved\n", encoding="utf-8")
    env = dict(os.environ)
    env.pop("DATABASE_URL", None)
    result = subprocess.run(
        [sys.executable, "-m", "career.cli", "pg-vault-sync", str(tmp_path), "--dry-run"],
        env=env, capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["approved"] == 0
