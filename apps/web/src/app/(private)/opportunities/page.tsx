'use client';
import { useState } from 'react';
import { useResource } from '@/components/useResource';
import { useCareerSession } from '@/components/AuthGate';
import { ciFetch } from '@/lib/api';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
import { safeDateLabel } from '@/lib/data.mjs';
type Job={id:string,company_name:string,title:string,published_at:string|null,eligibility:string|null,match_score:number,apply_url:string,source?:string};
type Source={source_name:string,source_url:string,retrieved_at:string};
type Evidence={source_url:string,source_kind:string,excerpt:string,observed_at:string,claim:string};
type Assessment={status:string,confidence:number,assessed_at:string,reasons:unknown,contradictions:unknown};
type EvidenceBundle={job:{id:string,title:string},sources:Source[],evidence:Evidence[],assessments:Assessment[],note:string};
export default function Opportunities(){
  const {data,error,loading,reload}=useResource<{jobs:Job[]}>('jobs');
  const session=useCareerSession();
  const [search,setSearch]=useState('');
  const [checking,setChecking]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [evidence,setEvidence]=useState<EvidenceBundle|null>(null);
  const [evidenceError,setEvidenceError]=useState('');
  const [loadingEvidence,setLoadingEvidence]=useState(false);
  const [notice,setNotice]=useState('');
  const [scanError,setScanError]=useState('');
  async function checkSource(){
    setChecking(true);setScanError('');setNotice('');
    try {
      const result=await ciFetch<{imported:number,skipped:number,source:string,note:string}>('discover',session,{method:'POST'});
      setNotice(`${result.imported} public postings checked and stored from ${result.source}. ${result.note}`);
      reload();
    }catch(err){setScanError(err instanceof Error?err.message:'Unable to check source');}
    finally{setChecking(false);}
  }
  async function inspect(jobId:string){
    if(selected===jobId){setSelected(null);setEvidence(null);return;}
    setSelected(jobId);setEvidence(null);setEvidenceError('');setLoadingEvidence(true);
    try {
      const result=await ciFetch<EvidenceBundle>('jobs/'+jobId+'/evidence',session);
      setEvidence(result);
    } catch(error){setEvidenceError(error instanceof Error?error.message:'Evidence unavailable');}
    finally{setLoadingEvidence(false);}
  }
  const filtered=(data?.jobs||[]).filter(j=>(j.company_name+' '+j.title).toLowerCase().includes(search.toLowerCase()));
  return <><header className="page-header"><div><span className="eyebrow">DISCOVERY</span><h1>Opportunities</h1>
    <p className="muted">New public listings remain unverified until eligibility research confirms them.</p></div><button type="button" className="outline-button" disabled={checking} onClick={checkSource}>{checking?'Checking public feed…':'Check public jobs'}</button></header>
    {notice&&<p className="muted" role="status">{notice}</p>}
    {scanError&&<p className="error-message" role="alert">{scanError}</p>}
    <div className="toolbar"><input className="search" type="search" placeholder="Search companies or roles" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search opportunities"/><span className="muted">{filtered.length} shown</span></div>
    <section className="panel"><StateNotice loading={loading} error={error}/>
      {!loading&&!error&&<ResourceTable items={filtered} columns={[
        {key:'employer',label:'Company',render:r=><strong>{r.company_name}</strong>},
        {key:'role',label:'Role',render:r=>r.title},
        {key:'status',label:'Eligibility',render:r=><Status value={r.eligibility}/>},
        {key:'score',label:'Match',render:r=>r.match_score?`${r.match_score}%`:'Not scored'},
        {key:'source',label:'Source',render:r=>r.source==='remotive'?'Remotive':(r.source||'Unspecified')},
        {key:'evidence',label:'Evidence',render:r=><button type="button" className="text-link" onClick={()=>void inspect(r.id)}>{selected===r.id?'Hide':'View evidence'}</button>},
        {key:'date',label:'Published',render:r=>safeDateLabel(r.published_at)},
        {key:'apply',label:'Listing',render:r=><a className="text-link" target="_blank" rel="noopener noreferrer" href={r.apply_url}>View ↗</a>},
      ]} empty="No jobs have been ingested yet. Use Check public jobs to import recent unverified roles."/>}</section>
    {selected&&<section className="panel" aria-live="polite">
      <div className="section-title"><h2>Eligibility evidence</h2><button type="button" className="text-link" onClick={()=>{setSelected(null);setEvidence(null);}}>Close</button></div>
      {loadingEvidence&&<p className="muted">Loading source evidence…</p>}
      {evidenceError&&<p className="error-message" role="alert">{evidenceError}</p>}
      {evidence&&<>
        <p className="muted">{evidence.job.title}: {evidence.note}</p>
        <h3>Assessments</h3>
        {evidence.assessments.length===0?<p className="muted">No eligibility assessment yet. This position is not verified as eligible.</p>:
          <ul>{evidence.assessments.map((a,i)=><li key={i}><strong>{a.status}</strong> · confidence {Math.round(a.confidence*100)}% · {safeDateLabel(a.assessed_at)}</li>)}</ul>}
        <h3>Research sources</h3>
        {evidence.sources.length===0?<p className="muted">No recorded source.</p>:
          <ul>{evidence.sources.map((s,i)=><li key={i}>{s.source_name}: {s.source_url.startsWith('https://')?<a className="text-link" target="_blank" rel="noopener noreferrer" href={s.source_url}>Open source</a>:'Invalid source URL'}</li>)}</ul>}
        <h3>Supporting evidence</h3>
        {evidence.evidence.length===0?<p className="muted">No verified employer evidence collected.</p>:
          <ul>{evidence.evidence.map((e,i)=><li key={i}><strong>{e.source_kind}</strong>: {e.claim}. {e.excerpt.slice(0,400)} {e.source_url.startsWith('https://')&&<a className="text-link" href={e.source_url} target="_blank" rel="noopener noreferrer">Source</a>}</li>)}</ul>}
      </>}
    </section>}
  </>;
}
