"""Source ingestion and conservative research workflow for personal use."""
from datetime import datetime, timezone
from urllib.parse import urlparse
import httpx
from career.contracts.jobs import JobCandidate
from career.discovery.fetch import fetch_board


def normalize_remote_feed(payload: dict, now: datetime) -> list[JobCandidate]:
    """Normalize free Remotive feed; preserve attribution and publication evidence."""
    out=[]
    for row in payload.get('jobs',[]):
        try:
            dt=row.get('publication_date')
            date=datetime.fromisoformat(dt.replace('Z','+00:00')) if dt else None
            out.append(JobCandidate(source='remotive',source_job_id=str(row['id']),company_name=row['company_name'],
                company_domain=None,title=row['title'],description=row.get('description') or '',
                apply_url=row['url'],remote_text=row.get('candidate_required_location') or 'Remote',
                published_at=date,updated_at=None,first_seen_at=now,
                timestamp_source='publication_date' if date else 'unknown',
                timestamp_confidence='authoritative' if date else 'unknown',source_url=row['url']))
        except (KeyError,ValueError,TypeError):
            continue
    return out


def infer_board_from_url(url:str)->tuple[str,str]|None:
    """Identify public ATS boards from exact known hostnames, never URL substrings."""
    import re
    parsed=urlparse(url)
    if parsed.scheme not in ('https','http') or not parsed.hostname:return None
    hosts={'jobs.lever.co':'lever','boards.greenhouse.io':'greenhouse','job-boards.greenhouse.io':'greenhouse','jobs.ashbyhq.com':'ashby'}
    provider=hosts.get(parsed.hostname.lower())
    if not provider:return None
    slug=parsed.path.strip('/').split('/')[0]
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',slug):return None
    return provider,slug


async def ingest_board(platform,board:dict,client:httpx.AsyncClient,now:datetime)->int:
    jobs=await fetch_board(board['provider'],board['slug'],board['company_name'],board['domain'],client,now)
    added=0
    for job in jobs:
        before=platform.db.execute('SELECT count(*) FROM jobs').fetchone()[0]
        platform.record_job(source=job.source,source_job_id=job.source_job_id,company_name=job.company_name,
            company_domain=job.company_domain,title=job.title,description=job.description,apply_url=str(job.apply_url),
            remote_text=job.remote_text,published_at=job.published_at.isoformat() if job.published_at else None,now=now)
        added+=platform.db.execute('SELECT count(*) FROM jobs').fetchone()[0]>before
    return added


async def ingest_remotive(platform,client:httpx.AsyncClient,now:datetime,search='software engineer')->int:
    """Discover companies outside fixed board registry via remote feed.

    Remotive has caching, rate and attribution requirements; run at most a few times daily.
    """
    response=await client.get('https://remotive.com/api/remote-jobs',params={'search':search,'limit':100},timeout=30.0)
    response.raise_for_status()
    total=0
    for job in normalize_remote_feed(response.json(),now):
        board=infer_board_from_url(str(job.apply_url))
        if board: platform.add_board(board[0],board[1],job.company_name,job.company_domain)
        existing=platform.db.execute('SELECT count(*) FROM jobs').fetchone()[0]
        platform.record_job(source=job.source,source_job_id=job.source_job_id,company_name=job.company_name,
           company_domain=job.company_domain,title=job.title,description=job.description,
           apply_url=str(job.apply_url),remote_text=job.remote_text,
           published_at=job.published_at.isoformat() if job.published_at else None,now=now)
        total+=int(platform.db.execute('SELECT count(*) FROM jobs').fetchone()[0]>existing)
    return total


async def run_discovery(platform,search_terms:list[str],now:datetime|None=None)->dict:
    """Fetch each configured ATS and a bounded rotating remote search."""
    now=now or datetime.now(timezone.utc)
    result={'new_jobs':0,'source_failures':[]}
    async with httpx.AsyncClient(headers={'User-Agent':'PersonalCareerResearch/0.5 (+self-hosted; contact via operator)'},follow_redirects=True) as client:
        for board in platform.boards():
            try: result['new_jobs']+=await ingest_board(platform,board,client,now)
            except (httpx.HTTPError,ValueError,KeyError) as e:
                result['source_failures'].append({'source':board['provider']+':'+board['slug'],'error':type(e).__name__})
        for term in search_terms[:2]:
            try:result['new_jobs']+=await ingest_remotive(platform,client,now,term)
            except (httpx.HTTPError,ValueError,KeyError) as e:
                result['source_failures'].append({'source':'remotive','error':type(e).__name__})
    return result
