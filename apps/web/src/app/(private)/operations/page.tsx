'use client';
import {PageHeading} from '@/components/WorkspaceUI';
import {DiscoveryPreferences} from '@/components/DiscoveryPreferences';
import {readinessGuidance} from '@/lib/readiness-guidance.mjs';
import {useState, type FormEvent} from 'react';
import {useResource} from '@/components/useResource';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {StateNotice} from '@/components/ResourceTable';

type WorkerRun={started_at:string,finished_at:string|null,state:string,details:Record<string,number>};
type Readiness={
  discovered_jobs:number,source_records:number,open_jobs:number,
  recent_confirmed_publication:number,eligibility_assessments:number,
  eligibility_evidence:number,active_ats_boards:number,pending_source_candidates:number
};
type Integrity={integrity_ok:boolean;integrity_violations:number;generation_ready:boolean;checked_at:string;
 daily_target:number;eligible_undelivered_jobs_now:number;approved_knowledge_documents:number;
 jobs_missing_sources:number;duplicate_source_ids:number;duplicate_canonical_jobs:number;
 invalid_apply_urls:number;verified_assessments_without_evidence:number;
 delivered_without_any_verified_assessment:number;delivered_jobs:number;};
type Operations={states:Record<string,number>,delivery?:{date:string,state:string,delivered:number,target:number}|null,workerRuns?:WorkerRun[],readiness?:Readiness,integrity?:Integrity};
type Source={id:string,name:string,state:string,config:{provider:string,slug:string,company_name:string}};
type Candidate={id:string,provider:string,board_slug:string,company_name:string,evidence_url:string,state:string};
type QueueItem={job_id:string,title:string,company_name:string,apply_url:string|null,first_queued_at:string};

export default function Operations(){
  const session=useCareerSession();
  const tasks=useResource<Operations>('operations');
  const sources=useResource<{sources:Source[]}>('sources');
  const candidates=useResource<{candidates:Candidate[]}>('source-candidates');
  const review=useResource<{items:QueueItem[]}>('eligibility-queue');
  const [provider,setProvider]=useState('greenhouse');
  const [slug,setSlug]=useState('');
  const [company,setCompany]=useState('');
  const [busy,setBusy]=useState(false);
  const [scanning,setScanning]=useState<string|null>(null);
  const [deciding,setDeciding]=useState<string|null>(null);
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

  async function decideCandidate(id:string,decision:'approved'|'rejected'){
    setDeciding(id);setError('');setMessage('');
    try{
      await ciFetch('source-candidates/decision',session,{
        method:'POST',body:JSON.stringify({candidate_id:id,decision})
      });
      setMessage(decision==='approved'?'Source approved. Run a bounded scan to retrieve postings.':'Source rejected.');
      candidates.reload();sources.reload();
    }catch(e){setError(e instanceof Error?e.message:'Unable to review source candidate');}
    finally{setDeciding(null);}
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
    <PageHeading meta="SYSTEM / OPERATIONS" title="Agent operations" description="Review source discovery, eligibility research, and scheduled work using real system activity." action={<button className="button-secondary" type="button" onClick={()=>{tasks.reload();sources.reload();review.reload();candidates.reload();}}>Refresh activity</button>}/>
    <StateNotice loading={tasks.loading} error={tasks.error}/>
    <section className="metric-grid">{Object.entries(tasks.data?.states||{}).map(([state,count])=><div className="metric" key={state}>
      <span>{state.replace(/_/g,' ')}</span><strong>{count}</strong></div>)}</section>
    {tasks.data&&Object.keys(tasks.data.states).length===0&&<div className="empty-state">No PostgreSQL workflow tasks have been created yet.</div>}
    <DiscoveryPreferences/>
    <section className="workspace-surface" aria-labelledby="readiness-heading">
      <div className="section-title"><div>
        <h2 id="readiness-heading">Recommendation pipeline health</h2>
        <p className="muted">Observed production counts, not estimated eligible opportunities. A role is recommended only when every evidence and deduplication gate passes.</p>
      </div></div>
      {tasks.data?.readiness?
        <div>
          <div className="metric-grid">
            {([
              ['Discovered jobs',tasks.data.readiness.discovered_jobs],
              ['Source records',tasks.data.readiness.source_records],
              ['Confirmed open',tasks.data.readiness.open_jobs],
              ['Published within 7 days',tasks.data.readiness.recent_confirmed_publication],
              ['Eligibility assessments',tasks.data.readiness.eligibility_assessments],
              ['Eligibility evidence',tasks.data.readiness.eligibility_evidence],
              ['Active ATS boards',tasks.data.readiness.active_ats_boards],
              ['Board suggestions to review',tasks.data.readiness.pending_source_candidates],
            ] as const).map(([label,value])=><div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          {readinessGuidance(tasks.data.readiness).length>0&&
            <div className="guidance-surface">
              <h3>Why the batch may be empty</h3>
              <ul>{readinessGuidance(tasks.data.readiness).map((message:string)=><li key={message}>{message}</li>)}</ul>
              <p className="muted">These are diagnostic counts, not an exhaustive or additive funnel. A job can fail multiple requirements.</p>
            </div>}
        </div>:
        <p className="muted">Pipeline health appears after the next successful authenticated API refresh.</p>}
    </section>
    <section className="workspace-surface" aria-labelledby="integrity-heading">
      <div className="section-title"><div><h2 id="integrity-heading">Production integrity audit</h2>
        <p className="muted">Read-only checks against real database records. Passing checks do not imply that suitable jobs exist.</p>
      </div></div>
      {tasks.data?.integrity?<div>
        <p role="status"><strong>{tasks.data.integrity.integrity_ok?'No integrity violations detected':'Integrity violations detected'}</strong>
          {' · '+tasks.data.integrity.integrity_violations+' problems · Audited '+new Date(tasks.data.integrity.checked_at).toLocaleString()}</p>
        <div className="metric-grid">
          <div className="metric"><span>Configured daily target</span><strong>{tasks.data.integrity.daily_target}</strong></div>
          <div className="metric"><span>Currently qualified, undelivered jobs</span><strong>{tasks.data.integrity.eligible_undelivered_jobs_now}</strong></div>
          <div className="metric"><span>Approved knowledge notes</span><strong>{tasks.data.integrity.approved_knowledge_documents}</strong></div>
          <div className="metric"><span>Delivered jobs</span><strong>{tasks.data.integrity.delivered_jobs}</strong></div>
        </div>
        {!tasks.data.integrity.generation_ready&&<p className="muted">Generation is not yet ready: either qualifying evidence is missing or the integrity checks failed.</p>}
        <div className="guidance-surface">
          <h3>Data consistency checks</h3>
          <ul>
            {([
              ['Jobs missing source records',tasks.data.integrity.jobs_missing_sources],
              ['Duplicate source identifiers',tasks.data.integrity.duplicate_source_ids],
              ['Duplicate canonical job records',tasks.data.integrity.duplicate_canonical_jobs],
              ['Invalid application links',tasks.data.integrity.invalid_apply_urls],
              ['Verified assessments without evidence',tasks.data.integrity.verified_assessments_without_evidence],
              ['Delivered jobs without verification history',tasks.data.integrity.delivered_without_any_verified_assessment],
            ] as const).map(([label,count])=><li key={label}>{label}: <strong>{count}</strong></li>)}
          </ul>
        </div>
      </div>:<p className="muted">Integrity audit data is not available from the current API deployment.</p>}
    </section>
    <div className="operations-overview-grid"><section className="workspace-surface">
      <div className="section-title"><div><h2>Daily recommendations</h2>
        <p className="muted">Automatic batch assembly is scheduled for 07:00 Lagos time. Only verified-eligible jobs with source evidence can be delivered.</p>
      </div></div>
      {tasks.data?.delivery?
        <p className="muted">Latest batch: {tasks.data.delivery.date} · {tasks.data.delivery.delivered} of {tasks.data.delivery.target} employers · {tasks.data.delivery.state}</p>:
        <p className="muted">No daily delivery batch has been generated yet.</p>}
    </section>
    <section className="workspace-surface">
      <div className="section-title"><div><h2>Unattended discovery worker</h2>
        <p className="muted">Authenticated scheduled runs. Public-source research and eligibility checks only; no emails or simulated metrics.</p></div></div>
      {(tasks.data?.workerRuns||[]).map((run,i)=><div className="section-title" key={i}>
        <div><strong>{run.state}</strong><p className="muted">{new Date(run.started_at).toLocaleString()}</p></div>
        <p className="muted">Remotive jobs {run.details?.remotive??0} · Himalayas jobs {run.details?.himalayas??0} · ATS jobs {run.details?.ats_jobs??0} · Reviews {run.details?.reviewed??0} · Matches {run.details?.matched??0} · Source candidates {run.details?.candidates??0} · Failures {run.details?.failures??0}</p>
      </div>)}
      {tasks.data?.workerRuns?.length===0&&<p className="muted">No scheduled worker runs recorded yet.</p>}
    </section>
    </div>
    <section className="workspace-surface">
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
    <section className="workspace-surface">
      <div className="section-title"><div><h2>Discovered ATS candidates</h2>
        <p className="muted">Possible employer job boards found in attributed public postings. Review each source before activation; company identity is not yet verified.</p></div></div>
      <StateNotice loading={candidates.loading} error={candidates.error}/>
      {(candidates.data?.candidates||[]).map(c=><div className="section-title" key={c.id}>
        <div><strong>{c.company_name}</strong><p className="muted">{c.provider} · {c.board_slug}</p>
          <a href={c.evidence_url} target="_blank" rel="noopener noreferrer" className="text-link">View original listing</a></div>
        <div>
          <button type="button" className="outline-button" disabled={deciding!==null} onClick={()=>void decideCandidate(c.id,'approved')}>Approve board</button>
          <button type="button" className="outline-button" disabled={deciding!==null} onClick={()=>void decideCandidate(c.id,'rejected')}>Reject</button>
        </div>
      </div>)}
      {candidates.data?.candidates.length===0&&<p className="muted">No unreviewed source candidates. Check public jobs to look for linked ATS boards.</p>}
    </section>
    <section className="workspace-surface">
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
