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

def test_malformed_approval_and_scope_are_rejected():
    content='---\nstatus: approved\nstatus: pending\nvisibility: outreach-safe\n---\nPrivate'
    assert parse_note('01-experience/work.md',content) is None
    assert parse_note('01-experience/work.md','---\nstatus: approved\nvisibility: private\n---\nPrivate') is None
    assert parse_note('01-experience/work.md','---\nstatus: approved\nvisibility: outreach-safe\n---\n') is None


def test_nested_private_notes_and_hidden_directories_never_index():
    assert not permitted_path('01-experience/07-private/secret.md')
    assert not permitted_path('01-experience/.obsidian/plugin.md')
    assert not permitted_path('01-experience/private/secrets.md')
    assert not permitted_path('01-experience/back\\\\slash.md')


def test_vault_scan_ignores_symlinks_and_unapproved_files(tmp_path):
    from career.knowledge.vault import scan_approved_vault
    folder=tmp_path/'01-experience'
    folder.mkdir()
    file=folder/'work.md'
    file.write_text('---\nstatus: approved\nvisibility: matching-safe\n---\nPython and distributed systems')
    (folder/'draft.md').write_text('---\nstatus: pending\nvisibility: agents-safe\n---\nPrivate')
    (folder/'copy.md').symlink_to(file)
    accepted,skipped=scan_approved_vault(tmp_path)
    assert list(accepted)==['01-experience/work.md']
    assert skipped==2


def test_scan_fails_closed_on_oversized_notes(tmp_path):
    import pytest
    from career.knowledge.vault import scan_approved_vault,MAX_NOTE_BYTES
    folder=tmp_path/'00-profile'
    folder.mkdir()
    (folder/'work.md').write_text('---\nstatus: approved\nvisibility: agents-safe\n---\n'+'x'*(MAX_NOTE_BYTES+1))
    with pytest.raises(ValueError,match='oversized'):
        scan_approved_vault(tmp_path)
