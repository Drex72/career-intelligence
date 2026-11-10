'use client';
import { useState } from 'react';
import { useResource } from '@/components/useResource';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
import { safeDateLabel } from '@/lib/data.mjs';
type Job={id:string,company_name:string,title:string,published_at:string|null,eligibility:string|null,match_score:number,apply_url:string};
export default function Opportunities(){
  const {data,error,loading}=useResource<{jobs:Job[]}>('jobs');const [search,setSearch]=useState('');
  const filtered=(data?.jobs||[]).filter(j=>(j.company_name+' '+j.title).toLowerCase().includes(search.toLowerCase()));
  return <><header className="page-header"><div><span className="eyebrow">DISCOVERY</span><h1>Opportunities</h1>
    <p className="muted">Real job postings with eligibility evidence and publication history.</p></div></header>
    <div className="toolbar"><input className="search" type="search" placeholder="Search companies or roles" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search opportunities"/><span className="muted">{filtered.length} shown</span></div>
    <section className="panel"><StateNotice loading={loading} error={error}/>
      {!loading&&!error&&<ResourceTable items={filtered} columns={[
        {key:'employer',label:'Company',render:r=><strong>{r.company_name}</strong>},
        {key:'role',label:'Role',render:r=>r.title},
        {key:'status',label:'Eligibility',render:r=><Status value={r.eligibility}/>},
        {key:'score',label:'Match',render:r=>r.match_score?`${r.match_score}%`:'Not scored'},
        {key:'date',label:'Published',render:r=>safeDateLabel(r.published_at)},
        {key:'apply',label:'Listing',render:r=><a className="text-link" target="_blank" rel="noopener noreferrer" href={r.apply_url}>View ↗</a>},
      ]} empty="No jobs have been ingested yet. Configure the PostgreSQL discovery worker to populate this view."/>}</section>
  </>;
}
