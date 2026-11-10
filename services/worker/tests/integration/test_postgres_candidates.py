"""Unverified public source suggestions never become scannable without explicit approval."""
import os
import pytest
from uuid import uuid4

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='Isolated PostgreSQL required')
def test_ats_candidates_require_review_and_preserve_groundwork():
    import psycopg
    name='Candidate '+uuid4().hex[:9]
    slug='team-'+uuid4().hex[:9]
    url='https://remotive.com/remote-jobs/software-dev/backend-123'
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        proposed=db.execute('select ci_suggest_ats_board(%s,%s,%s,%s)',
            ('ashby',slug,name,url)).fetchone()[0]
        assert proposed is True
        assert db.execute('select ci_suggest_ats_board(%s,%s,%s,%s)',
            ('ashby',slug,name,url)).fetchone()[0] is False
        candidate=db.execute('select id,state from ci_ats_source_candidates where board_slug=%s',
            (slug,)).fetchone()
        assert candidate[1]=='pending'
        assert db.execute('select count(*) from ci_discovery_sources where name=%s',
            ('ats:ashby:'+slug,)).fetchone()[0]==0
        assert db.execute('select ci_decide_ats_candidate(%s,%s)',
            (candidate[0],'approved')).fetchone()[0] is True
        assert db.execute('select ci_decide_ats_candidate(%s,%s)',
            (candidate[0],'approved')).fetchone()[0] is False
        active=db.execute('select config from ci_discovery_sources where name=%s',
            ('ats:ashby:'+slug,)).fetchone()
        assert active is not None
        assert active[0]['company_name']==name

@pytest.mark.skipif(not os.getenv('PG_TEST_DSN'),reason='Isolated PostgreSQL required')
def test_ats_candidate_is_rejected_and_no_client_privilege():
    import psycopg
    slug='reject-'+uuid4().hex[:9]
    with psycopg.connect(os.environ['PG_TEST_DSN'],autocommit=True) as db:
        assert db.execute('select ci_suggest_ats_board(%s,%s,%s,%s)',
            ('lever',slug,'Another Company','https://remotive.com/remote-jobs/example')).fetchone()[0]
        candidate=db.execute('select id from ci_ats_source_candidates where board_slug=%s',(slug,)).fetchone()[0]
        assert db.execute('select ci_decide_ats_candidate(%s,%s)',(candidate,'rejected')).fetchone()[0]
        assert db.execute('select count(*) from ci_discovery_sources where name=%s',
            ('ats:lever:'+slug,)).fetchone()[0]==0
        for role in ('anon','authenticated'):
            assert not db.execute('select has_table_privilege(%s,%s,%s)',
                (role,'ci_ats_source_candidates','SELECT')).fetchone()[0]
            assert not db.execute('select has_function_privilege(%s,%s,%s)',
                (role,'ci_decide_ats_candidate(uuid,text)','EXECUTE')).fetchone()[0]
