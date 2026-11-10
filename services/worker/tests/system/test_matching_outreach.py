from career.platform import CareerPlatform
from career.matching_worker import rank_eligible_jobs
from career.outreach_worker import prepare_outreach


def test_matching_uses_approved_vault_context(tmp_path):
    vault=tmp_path/'vault'; (vault/'03-skills').mkdir(parents=True)
    (vault/'03-skills'/'tech.md').write_text('---\nstatus: approved\nvisibility: matching-safe\n---\nPython, backend, infrastructure')
    with CareerPlatform(tmp_path/'db') as app:
        app.ingest_vault(vault)
        jid=app.record_job(source='test',source_job_id='a',company_name='Example',company_domain='example.com',title='Python backend infrastructure',description='Python backend engineer',apply_url='https://example.com/jobs/a',remote_text='remote',published_at=None)
        app.set_eligibility(jid,'verified_eligible','Nigeria eligibility confirmed','https://example.com/policy')
        result=rank_eligible_jobs(app)
        assert result['ranked']==1
        assert app.get_job(jid)['score']>0


def test_outreach_drafts_only_with_approved_profile(tmp_path):
    vault=tmp_path/'vault'; (vault/'00-profile').mkdir(parents=True)
    (vault/'00-profile'/'intro.md').write_text('---\nstatus: approved\nvisibility: outreach-safe\n---\nI built backend infrastructure services.')
    with CareerPlatform(tmp_path/'db') as app:
        app.ingest_vault(vault)
        jid=app.record_job(source='test',source_job_id='a',company_name='Example',company_domain='example.com',title='Python Backend',description='Remote',apply_url='https://example.com/jobs/a',remote_text='remote',published_at=None)
        app.set_eligibility(jid,'verified_eligible','Hiring from Nigeria','https://example.com/policy')
        cid=app.add_contact(app.get_job(jid)['company_id'],'Jane Example','Engineering Manager','https://example.com/team/jane')
        assert prepare_outreach(app,'owner')['drafted']==1
        assert prepare_outreach(app,'owner')['drafted']==0
        draft=app.db.execute('SELECT body FROM outreach WHERE contact_id=?',(cid,)).fetchone()['body']
        assert 'backend infrastructure' in draft
        assert 'KAIST' not in draft
