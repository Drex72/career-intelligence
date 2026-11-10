from pathlib import Path
from career.knowledge.vault import permitted_path, parse_note, diff_revision

def test_private_path_excluded():
    assert not permitted_path('07-private/personal-notes.md')
    assert not permitted_path('01-experience/../07-private/secret.md')

def test_unapproved_note_excluded():
    assert parse_note('01-experience/work.md', '---\nstatus: draft\nvisibility: outreach-safe\n---\n# Work') is None

def test_approved_note_is_versioned():
    doc=parse_note('01-experience/work.md','---\nstatus: approved\nvisibility: outreach-safe\n---\n# Work\nBuilt reliable services')
    assert doc is not None and doc.sha256 and 'reliable services' in doc.body

def test_only_approved_note_allowed():
    assert parse_note('00-profile/me.md','# Information without approval') is None

def test_deletion_detected():
    assert diff_revision({'x.md':'abc','y.md':'def'},{'x.md':'abc'}) == {'changed': set(), 'removed': {'y.md'}}
