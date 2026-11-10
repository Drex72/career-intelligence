'use client';
import {useState, type FormEvent} from 'react';
import {useResource} from '@/components/useResource';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {StateNotice} from '@/components/ResourceTable';

type Operations={states:Record<string,number>,delivery?:{date:string,state:string,delivered:number,target:number}|null};
type Source={id:string,name:string,state:string,config:{provider:string,slug:string,company_name:string}};
type QueueItem={job_id:string,title:string,company_name:string,apply_url:string|null,first_queued_at:string};

export default function Operations(){
  const session=useCareerSession();
  const tasks=useResource<Operations>('operations');
  const sources=useResource<{sources:Source[]}>('sources');
  const review=useResource<{items:QueueItem[]}>('eligibility-queue');
  const [provider,setProvider]=useState('greenhouse');
  const [slug,setSlug]=useState('');
  const [company,setCompany]=useState('');
  const [busy,setBusy]=useState(false);
  const [scanning,setScanning]=useState<string|null>(null);
  const [reviewing,setReviewing]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  async function addBoard(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const result=await ciFetch<{source_id:string,registered:boolean}>('sources',session,{
        method:'POST',body:JSON.stringify({provider,slug:slug.trim(),company:company.trim()})
      });
      setMessage(result.registered?'ATS board registered. Run a scan to retrieve recent jobs.':'This ATS board was already registered.');
      sources.reload();setSlug('');setCompany('');
    }catch(e){setError(e instanceof Error?e.message:'Could not register board');}
    finally{setBusy(false);}
  }

  async function scanBoard(id:string){
    setScanning(id);setError('');setMessage('');
    try{
      const result=await ciFetch<{processed:number,rejected:number,available:number,note:string}>('sources/scan',session,{
        method:'POST',body:JSON.stringify({source_id:id})
      });
      setMessage('Processed '+result.processed+' public ATS listings ('+result.rejected+' rejected). '+result.note);
      review.reload();tasks.reload();
    }catch(e){setError(e instanceof Error?e.message:'ATS scan failed');}
    finally{setScanning(null);}
  }

  async function reviewJob(id:string){
    setReviewing(id);setError('');setMessage('');
    try{
      const result=await ciFetch<{status:string,confidence:number,reason:string}>('eligibility/review',session,{
        method:'POST',body:JSON.stringify({job_id:id})
      });
      setMessage('Eligibility: '+result.status+' ('+Math.round(result.confidence*100)+'% confidence). '+result.reason);
      review.reload();tasks.reload();
    }catch(e){setError(e instanceof Error?e.message:'Official ATS review failed');}
    finally{setReviewing(null);}
  }

  return <>
    <header className="page-header"><div><span className="eyebrow">WORKFLOW RELIABILITY</span><h1>Agent operations</h1>
      <p className="muted">Real queued tasks and source activity. No simulated metrics.</p></div>
      <button className="outline-button" onClick={()=>{tasks.reload();sources.reload();review.reload();}}>Refresh</button>
    </header>
    <StateNotice loading={tasks.loading} error={tasks.error}/>
    <section className="metric-grid">{Object.entries(tasks.data?.states||{}).map(([state,count])=><div className="metric" key={state}>
      <span>{state.replace(/_/g,' ')}</span><strong>{count}</strong></div>)}</section>
    {tasks.data&&Object.keys(tasks.data.states).length===0&&<div className="empty-state">No PostgreSQL workflow tasks have been created yet.</div>}
    <section className="panel">
      <div className="section-title"><div><h2>Daily recommendations</h2>
        <p className="muted">Automatic batch assembly is scheduled for 07:00 Lagos time. Only verified-eligible jobs with source evidence can be delivered.</p>
      </div></div>
      {tasks.data?.delivery?
        <p className="muted">Latest batch: {tasks.data.delivery.date} · {tasks.data.delivery.delivered} of {tasks.data.delivery.target} employers · {tasks.data.delivery.state}</p>:
        <p className="muted">No daily delivery batch has been generated yet.</p>}
    </section>
    <section className="panel">
      <div className="section-title"><div><h2>Public ATS boards</h2>
        <p className="muted">Register Greenhouse, Lever or Ashby public boards. No private scraping, paid services or emails.</p></div></div>
      <form onSubmit={e=>void addBoard(e)} className="toolbar">
        <label>Provider <select value={provider} onChange={e=>setProvider(e.target.value)}>
          <option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option>
        </select></label>
        <label>Board slug <input required maxLength={100} pattern="[A-Za-z0-9_-]+" value={slug} onChange={e=>setSlug(e.target.value)} placeholder="example-company"/></label>
        <label>Company <input required maxLength={180} value={company} onChange={e=>setCompany(e.target.value)} placeholder="Company name"/></label>
        <button type="submit" className="outline-button" disabled={busy}>{busy?'Registering…':'Register board'}</button>
      </form>
      {message&&<p role="status" className="muted">{message}</p>}
      {error&&<p role="alert" className="error-message">{error}</p>}
      <StateNotice loading={sources.loading} error={sources.error}/>
      {(sources.data?.sources||[]).map(source=><div key={source.id} className="section-title">
        <div><strong>{source.config.company_name}</strong>
          <p className="muted">{source.config.provider} · {source.config.slug} · {source.state}</p></div>
        <button type="button" className="outline-button" disabled={scanning!==null} onClick={()=>void scanBoard(source.id)}>
          {scanning===source.id?'Scanning…':'Scan public listings'}
        </button>
      </div>)}
      {sources.data?.sources.length===0&&<p className="muted">No ATS boards registered yet. Scans are limited to once every six hours per board.</p>}
    </section>
    <section className="panel">
      <div className="section-title"><div><h2>Needs eligibility research</h2>
        <p className="muted">ATS listings are not eligible recommendations until role-specific employer evidence is reviewed.</p></div></div>
      <StateNotice loading={review.loading} error={review.error}/>
      {(review.data?.items||[]).slice(0,50).map(item=><div className="section-title" key={item.job_id}>
        <div><strong>{item.company_name}</strong><p className="muted">{item.title}</p></div>
        <div><button type="button" className="outline-button" disabled={reviewing!==null} onClick={()=>void reviewJob(item.job_id)}>
          {reviewing===item.job_id?'Reviewing…':'Review eligibility'}
        </button> {item.apply_url?.startsWith('https://')&&<a href={item.apply_url} target="_blank" rel="noopener noreferrer" className="text-link">Official posting</a>}</div>
      </div>)}
      {review.data?.items.length===0&&<p className="muted">No pending ATS eligibility-review tasks.</p>}
    </section>
  </>;
}
