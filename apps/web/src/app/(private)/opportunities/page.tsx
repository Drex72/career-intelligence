'use client';
import {useState} from 'react';
import {useResource} from '@/components/useResource';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {ResourceTable,StateNotice,Status} from '@/components/ResourceTable';
import {PageHeading,SectionHeading,Notice} from '@/components/WorkspaceUI';
import {safeDateLabel} from '@/lib/data.mjs';
type Job={id:string;company_name:string;title:string;published_at:string|null;eligibility:string|null;match_score:number;apply_url:string;source?:string};
type Source={source_name:string;source_url:string;retrieved_at:string};
type Evidence={source_url:string;source_kind:string;excerpt:string;observed_at:string;claim:string};
type Assessment={status:string;confidence:number;assessed_at:string;reasons:unknown;contradictions:unknown};
type EvidenceBundle={job:{id:string;title:string};sources:Source[];evidence:Evidence[];assessments:Assessment[];note:string};
type Filter='all'|'verified_eligible'|'likely_eligible'|'unverified';
const filters:{id:Filter;label:string}[]=[{id:'all',label:'All opportunities'},{id:'verified_eligible',label:'Verified eligible'},{id:'likely_eligible',label:'Likely eligible'},{id:'unverified',label:'Needs verification'}];
export default function Opportunities(){
  const {data,error,loading,reload}=useResource<{jobs:Job[]}>('jobs');
  const session=useCareerSession();
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<Filter>('all');
  const [checking,setChecking]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [evidence,setEvidence]=useState<EvidenceBundle|null>(null);
  const [evidenceError,setEvidenceError]=useState('');
  const [loadingEvidence,setLoadingEvidence]=useState(false);
  const [notice,setNotice]=useState('');
  const [scanError,setScanError]=useState('');
  async function checkSource(){
    setChecking(true);setScanError('');setNotice('');
    try{
      const result=await ciFetch<{imported:number;skipped:number;source:string;note:string}>('discover',session,{method:'POST'});
      setNotice(`${result.imported} public postings checked and stored from ${result.source}. ${result.note}`);
      reload();
    }catch(err){setScanError(err instanceof Error?err.message:'Unable to check source');}
    finally{setChecking(false);}
  }
  async function inspect(jobId:string){
    if(selected===jobId){setSelected(null);setEvidence(null);return;}
    setSelected(jobId);setEvidence(null);setEvidenceError('');setLoadingEvidence(true);
    try{const result=await ciFetch<EvidenceBundle>('jobs/'+jobId+'/evidence',session);setEvidence(result);}
    catch(err){setEvidenceError(err instanceof Error?err.message:'Evidence unavailable');}
    finally{setLoadingEvidence(false);}
  }
  const jobs=data?.jobs||[];
  const filtered=jobs.filter(j=>{
    const matches=(j.company_name+' '+j.title).toLowerCase().includes(search.trim().toLowerCase());
    return matches&&(filter==='all'||(filter==='unverified'?(!j.eligibility||j.eligibility==='unverified'||j.eligibility==='unknown'||j.eligibility==='pending'):j.eligibility===filter));
  });
  const selectedJob=jobs.find(j=>j.id===selected);
  return <div className="opportunity-page">
    <PageHeading meta="DISCOVER / EVALUATE" title="Find your next opportunity." description="Research employers, compare roles, and verify hiring eligibility before you apply."
      action={<button type="button" className="button-primary" disabled={checking} onClick={()=>void checkSource()}>{checking?'Checking public sources…':'Check public jobs'} <span aria-hidden="true">↗</span></button>}/>
    {notice&&<Notice tone="success">{notice}</Notice>}
    {scanError&&<Notice tone="danger" title="Source check failed">{scanError}</Notice>}
    <section className="workspace-surface opportunity-surface">
      <SectionHeading title="Opportunity explorer" description="Live public listings. Eligibility decisions always reference employer evidence."
        action={<span className="result-count">{filtered.length} of {jobs.length} roles</span>}/>
      <div className="explorer-controls">
        <label className="search-control"><span className="sr-only">Search by company or role</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search by company or job title" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <div className="filter-tabs" role="group" aria-label="Filter opportunities by eligibility">
          {filters.map(f=><button type="button" key={f.id} className={'filter-tab '+(filter===f.id?'is-selected':'')} aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>{f.label}</button>)}
        </div>
      </div>
      <StateNotice loading={loading} error={error}/>
      {!loading&&!error&&<ResourceTable rowKey={r=>r.id} ariaLabel="Matching opportunities" items={filtered} columns={[
        {key:'employer',label:'Employer & role',render:r=><div className="job-identity"><span className="company-avatar" aria-hidden="true">{r.company_name.charAt(0).toUpperCase()}</span><div><strong>{r.title}</strong><span>{r.company_name}</span></div></div>},
        {key:'status',label:'Hiring eligibility',render:r=><Status value={r.eligibility}/>},
        {key:'score',label:'Match',render:r=><span className="score-value">{r.match_score?Math.round(r.match_score)+'%':'—'}</span>},
        {key:'source',label:'Source',render:r=><span className="muted">{r.source==='remotive'?'Remotive':(r.source||'Unspecified')}</span>},
        {key:'date',label:'Posted',render:r=><span className="muted">{safeDateLabel(r.published_at)}</span>},
        {key:'actions',label:'Actions',render:r=><div className="table-inline-actions"><button type="button" className="table-action" aria-expanded={selected===r.id} onClick={()=>void inspect(r.id)}>{selected===r.id?'Hide evidence':'Evidence'}</button><a href={r.apply_url} target="_blank" rel="noopener noreferrer" className="table-action" aria-label={'View official listing for '+r.title+' at '+r.company_name}>Listing ↗</a></div>},
      ]} empty={search||filter!=='all'?'No positions match these filters. Try a different search or eligibility filter.':'No public jobs have been imported yet. Use Check public jobs to retrieve recent listings.'}/>}
    </section>
    {selected&&<section className="workspace-surface evidence-panel" aria-labelledby="evidence-title">
      <div className="section-heading"><div><p className="page-context">RESEARCH DETAIL</p><h2 id="evidence-title">Eligibility evidence</h2><p>{selectedJob?.company_name} · {selectedJob?.title||'Selected role'}</p></div><button type="button" className="button-secondary" onClick={()=>{setSelected(null);setEvidence(null);}}>Close panel</button></div>
      {loadingEvidence&&<div className="loading-state" role="status">Retrieving source evidence…</div>}
      {evidenceError&&<Notice tone="danger">{evidenceError}</Notice>}
      {evidence&&<div className="evidence-grid">
        <div className="evidence-column"><h3>Assessment history</h3>{evidence.assessments.length===0?<p className="muted">No assessment recorded. This job is not verified as eligible.</p>:<ul className="evidence-list">{evidence.assessments.map((a,i)=><li key={i}><Status value={a.status}/><span className="muted">{Math.round(a.confidence*100)}% confidence · {safeDateLabel(a.assessed_at)}</span></li>)}</ul>}</div>
        <div className="evidence-column"><h3>Official and public sources</h3>{evidence.sources.length===0?<p className="muted">No recorded sources yet.</p>:<ul className="evidence-list">{evidence.sources.map((s,i)=><li key={i}><strong>{s.source_name}</strong>{s.source_url.startsWith('https://')?<a className="table-action" href={s.source_url} target="_blank" rel="noopener noreferrer">Open source ↗</a>:<span className="muted">Source URL unavailable</span>}</li>)}</ul>}</div>
        <div className="evidence-column evidence-wide"><h3>Supporting claims</h3>{evidence.evidence.length===0?<p className="muted">No supporting employer claims collected.</p>:<ul className="evidence-list">{evidence.evidence.map((e,i)=><li key={i}><strong>{e.claim}</strong><p>{e.excerpt.slice(0,400)}</p>{e.source_url.startsWith('https://')&&<a href={e.source_url} target="_blank" rel="noopener noreferrer" className="table-action">View evidence source ↗</a>}</li>)}</ul>}</div>
      </div>}
    </section>}
  </div>;
}
