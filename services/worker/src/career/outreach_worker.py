"""Draft email preparation from approved facts; no sends, no guessed relations."""
from career.agents import build_outreach


def prepare_outreach(platform,owner,limit=100)->dict:
    approved_profile=platform.knowledge_for('outreach').strip()
    if not approved_profile:return {'drafted':0,'skipped':'no approved outreach-safe knowledge'}
    n=0
    for job in platform.jobs(limit=limit,eligibility='verified_eligible'):
        for contact in platform.contacts(job['company_id'])[:5]:
            exists=platform.db.execute('SELECT 1 FROM outreach WHERE owner=? AND job_id=? AND contact_id=?',(owner,job['id'],contact['id'])).fetchone()
            if exists:continue
            draft=build_outreach(contact['name'].split()[0],job['title'],job['company_name'],approved_profile)
            platform.draft_email(owner,job['id'],contact['id'],draft['subject'],draft['body'])
            n+=1
    return {'drafted':n}
