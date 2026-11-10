from career.conversation import process_reply
from career.platform import CareerPlatform

def test_optout_blocks_later_outreach(tmp_path):
    with CareerPlatform(tmp_path/'db') as app:
        result=process_reply(app,'owner','recruiter@example.com','Please remove me from your list, thanks.')
        assert result=='opt_out'
        assert app.db.execute('SELECT 1 FROM suppression WHERE email=?',('recruiter@example.com',)).fetchone()


def test_role_scoped_hiring_restriction_is_not_global(tmp_path):
    with CareerPlatform(tmp_path/'db') as app:
        j=app.record_job(source='test',source_job_id='a',company_name='Acme',company_domain='acme.test',title='SWE',description='Remote',apply_url='https://acme.test/jobs/a',remote_text='remote',published_at=None)
        cid=app.get_job(j)['company_id']
        kind=process_reply(app,'owner','recruiter@acme.test', 'Unfortunately, this particular role requires applicants to reside in the United States.',company_id=cid,job_id=j,source_url='https://mail.google.com/mail/u/0/#all/example')
        assert kind=='declined'
        facts=app.intelligence(cid)
        assert len(facts)==1 and facts[0]['job_id']==j
