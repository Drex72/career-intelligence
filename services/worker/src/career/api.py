"""Authenticated single-user API and minimal responsive dashboard (development runtime)."""
from __future__ import annotations
from datetime import date
from pathlib import Path
import os
import secrets
from fastapi import FastAPI,HTTPException,Request,Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from career.platform import CareerPlatform

class BoardIn(BaseModel):
    provider:str
    slug:str
    company_name:str
    domain:str|None=None
class ApplicationIn(BaseModel):
    status:str
class EligibilityIn(BaseModel):
    status:str
    reason:str
    source_url:str|None=None
class ContactIn(BaseModel):
    company_id:str
    name:str
    title:str
    profile_url:str
    email:str|None=None
    email_verified:bool=False
class DraftIn(BaseModel):
    job_id:str
    contact_id:str
    subject:str
    body:str

HTML='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Intelligence</title><style>
:root{color-scheme:dark;font:15px system-ui;background:#121715;color:#e5eee9}body{max-width:1180px;margin:auto;padding:30px}header{display:flex;justify-content:space-between;align-items:center}h1{font-size:28px;letter-spacing:-1px}h2{font-size:18px}p{color:#a7b9ae}.panel{background:#1d2621;border:1px solid #334339;border-radius:15px;padding:18px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.metric{font-size:30px;font-weight:750;color:#79d5a0}.item{border-top:1px solid #36483e;padding:12px 0}.tag{font-size:12px;background:#34483b;border-radius:8px;padding:4px 8px}a{color:#88daa9}button,input{background:#2e4938;color:white;border:1px solid #5b7967;border-radius:8px;padding:10px}button{cursor:pointer}small{color:#a7b9ae}#status{color:#91dfa8}</style></head><body><header><div><h1>Career Intelligence</h1><p>Worldwide opportunities · evidence-backed eligibility</p></div><span class="tag">PRIVATE DASHBOARD</span></header><div class="panel"><label>Access token <input id="token" type="password" autocomplete="off" placeholder="Enter your private token"></label> <button onclick="load()">Unlock dashboard</button><p id="status">No information is loaded without authorization.</p></div><div class="grid" id="metrics"></div><div class="panel"><h2>Daily opportunities</h2><button onclick="generate()">Generate today's batch</button><div id="batch"></div></div><div class="panel"><h2>All discovered jobs</h2><div id="jobs"></div></div><div class="panel"><h2>Saved applications</h2><div id="applications"></div></div><script>
const auth=()=>({'Authorization':'Bearer '+document.getElementById('token').value});async function call(url,method='GET'){const r=await fetch(url,{method,headers:auth()});if(!r.ok)throw new Error('Request rejected: '+r.status);return r.json()};function safe(s){const n=document.createElement('span');n.textContent=s??'';return n.innerHTML.replace(/\"/g,'&quot;').replace(/'/g,'&#39;')};function item(j){const link=String(j.apply_url||'');return `<div class="item"><strong>${safe(j.company_name)} · ${safe(j.title)}</strong><p>${safe(j.eligibility)} · ${safe(j.remote_text||'Location unspecified')} · ${safe(j.published_at||'Publication unknown')}</p><a href="${safe(link)}" target="_blank" rel="noopener noreferrer">Apply directly</a> <button data-job="${safe(j.id)}" onclick="save(this.dataset.job)">Mark applied</button></div>`};async function load(){try{let [m,j,a,b]=await Promise.all([call('/api/metrics'),call('/api/jobs'),call('/api/applications'),call('/api/batch/today')]);document.getElementById('metrics').innerHTML=Object.entries(m).map(([k,v])=>`<div class="panel"><small>${safe(k.replace('_',' '))}</small><div class="metric">${v}</div></div>`).join('');document.getElementById('jobs').innerHTML=j.map(item).join('')||'<p>No jobs yet. Add source boards or run discovery.</p>';document.getElementById('batch').innerHTML=b.map(item).join('')||'<p>No verified-eligible jobs in the current batch.</p>';document.getElementById('applications').innerHTML=a.map(x=>`<div class="item">${safe(x.company_name)} · ${safe(x.title)} — ${safe(x.status)}</div>`).join('')||'<p>No applications yet.</p>';document.getElementById('status').textContent='Loaded successfully'}catch(e){document.getElementById('status').textContent=e.message}};async function generate(){try{await call('/api/batch/generate','POST');await load()}catch(e){document.getElementById('status').textContent=e.message}};async function save(id){try{await call('/api/applications/'+id+'/applied','POST');await load()}catch(e){document.getElementById('status').textContent=e.message}}
</script></body></html>'''


def make_app(database:Path|str,token:str,owner:str='default')->FastAPI:
    if len(token)<8:raise ValueError('Set a strong access token (at least 8 characters)')
    app=FastAPI(title='Career Intelligence API',version='0.5')
    def authenticated(request:Request):
        header=request.headers.get('Authorization','')
        if not secrets.compare_digest(header,'Bearer '+token):raise HTTPException(401,'Unauthorized')
    def db():return CareerPlatform(database)
    @app.get('/',response_class=HTMLResponse)
    def homepage():return HTML
    @app.get('/api/health')
    def health():return {'status':'ok'}
    @app.get('/api/metrics',dependencies=[Depends(authenticated)])
    def metrics():
        with db() as p:return p.dashboard_metrics(owner)
    @app.get('/api/jobs',dependencies=[Depends(authenticated)])
    def jobs():
        with db() as p:return p.jobs()
    @app.post('/api/boards',dependencies=[Depends(authenticated)])
    def add_board(row:BoardIn):
        with db() as p:
            try:p.add_board(row.provider,row.slug,row.company_name,row.domain)
            except ValueError as e:raise HTTPException(400,str(e))
        return {'status':'saved'}
    @app.get('/api/boards',dependencies=[Depends(authenticated)])
    def boards():
        with db() as p:return p.boards()
    @app.get('/api/batch/today',dependencies=[Depends(authenticated)])
    def batch_today():
        with db() as p:return p.daily_batch(owner,date.today().isoformat())
    @app.post('/api/batch/generate',dependencies=[Depends(authenticated)])
    def generate_batch():
        with db() as p:return p.generate_batch(owner,date.today().isoformat())
    @app.post('/api/jobs/{job_id}/eligibility',dependencies=[Depends(authenticated)])
    def change_eligibility(job_id:str,row:EligibilityIn):
        with db() as p:
            try:p.set_eligibility(job_id,row.status,row.reason,row.source_url)
            except (ValueError,KeyError) as e:raise HTTPException(400,str(e))
            return p.get_job(job_id)
    @app.get('/api/applications',dependencies=[Depends(authenticated)])
    def applications():
        with db() as p:return p.applications(owner)
    @app.post('/api/applications/{job_id}/{status}',dependencies=[Depends(authenticated)])
    def apply(job_id:str,status:str):
        with db() as p:
            try:p.record_application(owner,job_id,status)
            except (ValueError,KeyError) as e:raise HTTPException(400,str(e))
        return {'status':status}
    @app.post('/api/contacts',dependencies=[Depends(authenticated)])
    def contact(row:ContactIn):
        with db() as p:
            try:cid=p.add_contact(**row.model_dump())
            except Exception as e:raise HTTPException(400,str(e))
            return {'id':cid}
    @app.get('/api/contacts/{company_id}',dependencies=[Depends(authenticated)])
    def contacts(company_id:str):
        with db() as p:return p.contacts(company_id)
    @app.post('/api/outreach/draft',dependencies=[Depends(authenticated)])
    def draft(row:DraftIn):
        with db() as p:
            try:ident=p.draft_email(owner,**row.model_dump())
            except (ValueError,KeyError) as e:raise HTTPException(400,str(e))
        return {'id':ident,'status':'draft'}
    @app.get('/api/outreach',dependencies=[Depends(authenticated)])
    def outreach():
        with db() as p:
            return [dict(r) for r in p.db.execute('''SELECT o.id,o.subject,o.status,o.auth_mode,o.created_at,
                  c.name contact_name,c.email,j.title job_title FROM outreach o
                  JOIN contacts c ON c.id=o.contact_id JOIN jobs j ON j.id=o.job_id
                  WHERE o.owner=? ORDER BY o.created_at DESC''',(owner,))]
    @app.get('/api/research/queue',dependencies=[Depends(authenticated)])
    def research_queue():
        with db() as p:return p.pending_research()
    @app.get('/api/knowledge/notes',dependencies=[Depends(authenticated)])
    def knowledge_notes():
        with db() as p:
            return [dict(r) for r in p.db.execute('SELECT path,sha,visibility FROM knowledge ORDER BY path')]
    @app.get('/api/intelligence/{company_id}',dependencies=[Depends(authenticated)])
    def company_intelligence(company_id:str):
        with db() as p:return p.intelligence(company_id)
    @app.post('/api/outreach/{draft_id}/approve',dependencies=[Depends(authenticated)])
    def approve(draft_id:str):
        with db() as p:return {'approved':p.authorize_message(draft_id,'manual')}
    return app


def from_env():
    token=os.environ.get('CAREER_ACCESS_TOKEN','')
    if len(token)<16:raise RuntimeError('CAREER_ACCESS_TOKEN must be at least 16 characters')
    path=os.environ.get('CAREER_DB_PATH','career.db')
    return make_app(path,token,os.environ.get('CAREER_OWNER','default'))
