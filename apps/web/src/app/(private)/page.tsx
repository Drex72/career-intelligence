'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {useResource} from '@/components/useResource';
import {ResourceTable,StateNotice} from '@/components/ResourceTable';
import {PageHeading,SectionHeading,MetricTile,Notice,InsetLink} from '@/components/WorkspaceUI';
import {safeDateLabel} from '@/lib/data.mjs';

type Counts={companies:number;jobs:number;delivered:number;applications:number};
type BatchItem={rank:number;job_id:string;company_name:string;title:string;apply_url:string;published_at:string|null};
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
      const result=await ciFetch<{inserted:number;note:string}>('batches/generate',session,{method:'POST'});
      setBatchNotice(result.inserted===0?'No new verified eligible employers were available.':'Added '+result.inserted+' new eligible employers. '+result.note);
      batch.reload();stats.reload();
    }catch(error){setBatchError(error instanceof Error?error.message:'Unable to generate batch');}
    finally{setGenerating(false);}
  }
  const metrics=[
    {label:'Discovered companies',value:stats.data?.companies??'—',hint:'Known employer records'},
    {label:'Open job records',value:stats.data?.jobs??'—',hint:'Across connected sources'},
    {label:'Companies delivered',value:stats.data?.delivered??'—',hint:'Evidence-gated recommendations'},
    {label:'Applications tracked',value:stats.data?.applications??'—',hint:'Recorded manually'},
  ];
  return <div className="overview-page">
    <PageHeading title="Your career, in focus." description="A clear view of the opportunities you've found, the evidence behind them, and what needs your attention." meta={'WORKSPACE / '+day}
      action={<Link className="button-primary" href="/opportunities">Explore opportunities <span aria-hidden="true">→</span></Link>}/>
    <div className="summary-strip" role="note"><span className="summary-indicator" aria-hidden="true"/><span>Only positions with verified hiring eligibility can enter your daily recommendations.</span><Link href="/operations">Review agent activity <span aria-hidden="true">↗</span></Link></div>
    <section aria-label="Workspace metrics" className="metric-layout">
      {metrics.map(metric=><MetricTile key={metric.label} {...metric}/>)}
    </section>
    <StateNotice loading={stats.loading} error={stats.error} retry={stats.reload}/>
    <div className="overview-columns">
      <section className="workspace-surface recommendations-surface">
        <SectionHeading title="Today's recommendations" description="Evidence-verified roles from employers you haven't been sent before."
          action={<button type="button" className="button-secondary" disabled={generating} onClick={()=>void generateBatch()}>{generating?'Generating…':'Generate batch'}</button>}/>
        {batchNotice&&<Notice tone="success">{batchNotice}</Notice>}
        {batchError&&<Notice tone="danger">{batchError}</Notice>}
        <StateNotice loading={batch.loading} error={batch.error} retry={batch.reload}/>
        {batch.data&&<ResourceTable rowKey={r=>r.job_id} ariaLabel="Today's recommended employers" items={batch.data.items} columns={[
          {key:'company',label:'Employer',render:r=><div className="table-primary"><span className="company-avatar" aria-hidden="true">{r.company_name.charAt(0).toUpperCase()}</span><strong>{r.company_name}</strong></div>},
          {key:'job',label:'Role',render:r=><span className="role-name">{r.title}</span>},
          {key:'published',label:'Published',render:r=><span className="muted">{safeDateLabel(r.published_at)}</span>},
          {key:'link',label:'Next step',render:r=>r.apply_url?.startsWith("https://")?<a href={r.apply_url} rel="noopener noreferrer" target="_blank" className="table-action">View posting <span aria-hidden="true">↗</span></a>:<span className="muted">Link unavailable</span>},
        ]} empty="No verified eligible employers were delivered today. You can browse current opportunities while the system continues researching."/>}
        <div className="surface-foot"><InsetLink href="/opportunities">See all opportunities</InsetLink></div>
      </section>
      <aside className="overview-aside" aria-label="Next steps">
        <div className="next-steps-card">
          <span className="aside-kicker">YOUR WORKFLOW</span><h2>Keep things moving</h2><p>Pick up where you left off. Every step is under your control.</p>
          <div className="quick-links">
            <InsetLink href="/applications"><span><strong>Track applications</strong><small>Update the status of jobs you've applied to</small></span></InsetLink>
            <InsetLink href="/outreach"><span><strong>Prepare outreach</strong><small>Draft messages for sourced contacts</small></span></InsetLink>
            <InsetLink href="/knowledge"><span><strong>Review your knowledge base</strong><small>Keep your professional context current</small></span></InsetLink>
          </div>
        </div>
        <div className="principle-card"><span className="principle-symbol" aria-hidden="true">✓</span><div><h3>Research, not guesswork.</h3><p>Hiring eligibility is never inferred from a generic remote label, and outreach is never sent automatically.</p></div></div>
      </aside>
    </div>
  </div>;
}
