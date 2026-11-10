'use client';
import { useState } from 'react';
import { useResource } from '@/components/useResource';
import { useCareerSession } from '@/components/AuthGate';
import { ciFetch } from '@/lib/api';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
import { safeDateLabel } from '@/lib/data.mjs';
type Job={id:string,company_name:string,title:string,published_at:string|null,eligibility:string|null,match_score:number,apply_url:string,source?:string};
export default function Opportunities(){
  const {data,error,loading,reload}=useResource<{jobs:Job[]}>('jobs');
  const session=useCareerSession();
  const [search,setSearch]=useState('');
  const [checking,setChecking]=useState(false);
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
        {key:'date',label:'Published',render:r=>safeDateLabel(r.published_at)},
        {key:'apply',label:'Listing',render:r=><a className="text-link" target="_blank" rel="noopener noreferrer" href={r.apply_url}>View ↗</a>},
      ]} empty="No jobs have been ingested yet. Use Check public jobs to import recent unverified roles."/>}</section>
  </>;
}
