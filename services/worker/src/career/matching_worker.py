"""Deterministic ranking fallback using approved personal facts only."""
from career.agents import score_match


def rank_eligible_jobs(platform,limit=1000)->dict:
    knowledge=platform.knowledge_for('matching')
    count=0
    for job in platform.jobs(limit=limit,eligibility='verified_eligible'):
        result=score_match(' '.join((job['title'],job['description'])),knowledge)
        platform.db.execute('UPDATE jobs SET score=? WHERE id=?',(result.score,job['id']))
        platform._event('job_ranked',job['id'],{'score':result.score,'matched':list(result.matched),'missing':list(result.missing)})
        count+=1
    return {'ranked':count}
