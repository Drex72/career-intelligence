'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import { useResource } from '@/components/useResource';
import { ResourceTable,StateNotice } from '@/components/ResourceTable';
import { safeDateLabel } from '@/lib/data.mjs';

type Counts={companies:number,jobs:number,delivered:number,applications:number};
type BatchItem={rank:number,job_id:string,company_name:string,title:string,apply_url:string,published_at:string|null};
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function Overview(){
  const session=useCareerSession();
  const [generating,setGenerating]=useState(false);
  const [batchNotice,setBatchNotice]=useState('');
  const [batchError,setBatchError]=useState('');
  const stats=useResource<Counts>('metrics');
  const batch=useResource<{items:BatchItem[]}>('batches/'+day);
  async function generateBatch(){
    setGenerating(true);setBatchError('');setBatchNotice('');
    try{
      const result=await ciFetch<{inserted:number,note:string}>('batches/generate',session,{method:'POST'});
      setBatchNotice(result.inserted===0?'No new verified eligible employers were available.':'Added '+result.inserted+' new eligible employers. '+result.note);
      batch.reload();stats.reload();
    }catch(error){setBatchError(error instanceof Error?error.message:'Unable to generate batch');}
    finally{setGenerating(false);}
  }
  return <><header className="page-header"><div><span className="eyebrow">YOUR CAREER OPERATING SYSTEM</span>
    <h1>Overview</h1><p className="muted">Verified opportunities and research activity, directly from PostgreSQL.</p></div>
    <div className="page-tag">{day}</div></header>
    <section className="metric-grid">
      {([['Discovered companies','companies'],['Job records','jobs'],['Companies delivered','delivered'],['Applications','applications']] as const).map(([label,key])=><div className="metric" key={key}><span>{label}</span><strong>{stats.data?.[key]??'—'}</strong></div>)}
    </section>
    <StateNotice loading={stats.loading} error={stats.error}/>
    <section className="panel"><div className="section-title"><div><h2>Today’s new employers</h2><p className="muted">Never repeated after delivery · Verified eligible positions only</p></div><div><button type="button" className="outline-button" disabled={generating} onClick={()=>void generateBatch()}>{generating?'Generating…':'Generate daily batch'}</button> <Link href="/opportunities" className="text-link">Browse jobs</Link></div></div>
      {batchNotice&&<p className="muted" role="status">{batchNotice}</p>}
      {batchError&&<p className="error-message" role="alert">{batchError}</p>}
      <StateNotice loading={batch.loading} error={batch.error}/>
      {batch.data&&<ResourceTable items={batch.data.items} columns={[
        {key:'rank',label:'#',render:r=><span className="rank">{r.rank}</span>},
        {key:'company',label:'Employer',render:r=><strong>{r.company_name}</strong>},
        {key:'job',label:'Position',render:r=>r.title},
        {key:'published',label:'Published',render:r=><span className="muted">{safeDateLabel(r.published_at)}</span>},
        {key:'link',label:'Apply',render:r=><a href={r.apply_url} rel="noopener noreferrer" target="_blank" className="text-link">Official listing ↗</a>},
      ]} empty="No verified eligible employers were delivered for this date. The system does not fabricate results to fill the 100-company target."/>}
    </section>
    <section className="two-cards"><div className="info-panel"><h3>Evidence before eligibility</h3><p>Remote listings stay unverified until current source evidence supports hiring from Nigeria.</p></div>
    <div className="info-panel"><h3>Outreach stays controlled</h3><p>Email sending is disabled by default. Drafts require explicit authorization and valid application state.</p></div></section>
  </>;
}
