"""CLI for personal Career Intelligence local development and scheduled runs.

Paid integrations and email delivery remain disabled without explicit credentials
and command flags. No GitHub/Supabase account modifications are performed here.
"""
import argparse
import asyncio
import json
import os
from datetime import date
from pathlib import Path
from uuid import UUID
import httpx
from career.platform import CareerPlatform
from career.pipeline import run_discovery
from career.eligibility_worker import run_eligibility_queue
from career.people_worker import run_people_queue
from career.integrations.simplify_csv import read_application_csv,export_application_csv


def build_parser():
    p=argparse.ArgumentParser(prog='career',description='Personal Career Intelligence worker')
    p.add_argument('--db',default=os.environ.get('CAREER_DB_PATH','career.db'))
    p.add_argument('--owner',default=os.environ.get('CAREER_OWNER','default'))
    sub=p.add_subparsers(dest='command',required=True)
    x=sub.add_parser('serve',help='Start authenticated local dashboard');x.add_argument('--host',default='127.0.0.1');x.add_argument('--port',type=int,default=8000)
    x=sub.add_parser('add-board',help='Add permitted public ATS board');x.add_argument('provider',choices=('lever','greenhouse','ashby'));x.add_argument('slug');x.add_argument('name');x.add_argument('--domain')
    x=sub.add_parser('discover',help='Ingest public sources and investigate eligibility');x.add_argument('--terms',default='software engineer,backend engineer')
    sub.add_parser('research-people',help='Research existing eligible company queue')
    sub.add_parser('generate-batch',help='Create daily nonduplicated eligible company batch')
    x=sub.add_parser('vault-sync',help='Ingest approved Obsidian notes');x.add_argument('directory')
    x=sub.add_parser('import-simplify',help='Import CSV application history');x.add_argument('file')
    x=sub.add_parser('export-simplify',help='Export compatible application CSV');x.add_argument('file')
    sub.add_parser('metrics',help='Print metrics JSON')
    x=sub.add_parser('pg-add-board',help='Register ATS board in ci_ PostgreSQL source registry'); x.add_argument('provider',choices=('greenhouse','lever','ashby')); x.add_argument('slug'); x.add_argument('name'); x.add_argument('--domain')
    x=sub.add_parser('pg-discover',help='Ingest permitted public feeds into ci_ PostgreSQL tables'); x.add_argument('--terms',default='backend engineer,software engineer'); x.add_argument('--board-limit',type=int,default=10); x.add_argument('--eligibility-limit',type=int,default=30)
    x=sub.add_parser('pg-research-eligibility',help='Verify pending role eligibility from official job pages'); x.add_argument('--limit',type=int,default=30)
    x=sub.add_parser('pg-generate-batch',help='Generate strict lifetime-deduplicated PostgreSQL batch'); x.add_argument('--owner-uuid',default=os.environ.get('CAREER_OWNER_UUID')); x.add_argument('--day',default=date.today().isoformat()); x.add_argument('--target',type=int,default=100)
    return p


async def _discover(platform,terms):
    results=await run_discovery(platform,terms)
    async with httpx.AsyncClient(headers={'User-Agent':'PersonalCareerResearch/0.5'},follow_redirects=False) as client:
        results['eligibility']=await run_eligibility_queue(platform,client)
        results['people']=await run_people_queue(platform,client)
    return results


def run(argv=None):
    args=build_parser().parse_args(argv)
    if args.command=='serve':
        token=os.environ.get('CAREER_ACCESS_TOKEN','')
        if len(token)<16:raise SystemExit('Set CAREER_ACCESS_TOKEN (16+ characters) before starting the server')
        from career.api import make_app
        import uvicorn
        uvicorn.run(make_app(args.db,token,args.owner),host=args.host,port=args.port)
        return
    if args.command.startswith('pg-'):
        from career.persistence.postgres_catalog import PostgresCareerCatalog
        from career.persistence.pg_discovery import register_board
        from career.persistence.pg_pipeline import run_pg_discovery
        from career.persistence.pg_eligibility import run_pg_eligibility
        dsn=os.environ.get('DATABASE_URL','')
        if not dsn:
            raise SystemExit('DATABASE_URL is required for PostgreSQL operations')
        with PostgresCareerCatalog(dsn) as catalog:
            if args.command=='pg-add-board':
                result={'registered':register_board(catalog,args.provider,args.slug,args.name,args.domain)}
            elif args.command=='pg-generate-batch':
                if not args.owner_uuid:
                    raise SystemExit('CAREER_OWNER_UUID or --owner-uuid required')
                result={'items':catalog.create_batch(UUID(args.owner_uuid),date.fromisoformat(args.day),args.target)}
            elif args.command in ('pg-discover','pg-research-eligibility'):
                async def gather():
                    async with httpx.AsyncClient(headers={'User-Agent':'PersonalCareerResearch/0.5'},
                                                 follow_redirects=False) as client:
                        discovery = (await run_pg_discovery(catalog,client,args.terms.split(','),
                                       board_limit=args.board_limit)) if args.command=='pg-discover' else None
                        eligibility=await run_pg_eligibility(catalog,client,limit=(
                            args.eligibility_limit if args.command=='pg-discover' else args.limit))
                        return {'discovery':discovery,'eligibility':eligibility}
                result=asyncio.run(gather())
            else:raise AssertionError(args.command)
        print(json.dumps(result,default=str,indent=2));return
    with CareerPlatform(args.db) as platform:
        if args.command=='add-board':
            platform.add_board(args.provider,args.slug,args.name,args.domain);result={'saved':True}
        elif args.command=='discover':result=asyncio.run(_discover(platform,args.terms.split(',')[:2]))
        elif args.command=='research-people':
            async def task():
                async with httpx.AsyncClient(follow_redirects=False) as client:return await run_people_queue(platform,client)
            result=asyncio.run(task())
        elif args.command=='generate-batch':result=platform.generate_batch(args.owner,date.today().isoformat())
        elif args.command=='vault-sync':result={'indexed':platform.ingest_vault(Path(args.directory))}
        elif args.command=='metrics':result=platform.dashboard_metrics(args.owner)
        elif args.command=='import-simplify':
            records=read_application_csv(Path(args.file).read_text(encoding='utf-8-sig'))
            for r in records:
                jid=platform.record_job(source='simplify',source_job_id=None,company_name=r['company'] or 'Unknown',company_domain=None,
                    title=r['title'] or 'Unknown role',description='',apply_url=r['url'],remote_text=None,published_at=None)
                platform.record_application(args.owner,jid,r['status'])
            result={'imported':len(records)}
        elif args.command=='export-simplify':
            rows=[]
            for a in platform.applications(args.owner):
                j=platform.get_job(a['job_id']);rows.append({'Company':a['company_name'],'Job Title':a['title'],'Job URL':j['apply_url'],'Status':a['status'].title()})
            Path(args.file).write_text(export_application_csv(rows),encoding='utf-8');result={'exported':len(rows)}
        else:raise AssertionError(args.command)
    print(json.dumps(result,default=str,indent=2))


if __name__=='__main__':run()
