from career.persistence.pg_conversation import classify_employer_reply


def test_nigeria_job_restriction_keeps_role_specific_scope():
    r=classify_employer_reply('Unfortunately, this particular position requires candidates to reside in the United States.')
    assert r['event_type']=='declined'
    assert r['job_restriction'] is True
    assert r['scope']=='job'


def test_generic_negative_reply_does_not_invent_hiring_policy():
    r=classify_employer_reply('Unfortunately we moved forward with another candidate.')
    assert r['event_type']=='declined'
    assert not r['job_restriction']


def test_opt_out_classification_works_without_inference():
    r=classify_employer_reply('Please remove me from your email list')
    assert r['event_type']=='opt_out'
    assert not r['job_restriction']
