'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {useResource} from '@/components/useResource';
import {ResourceTable,StateNotice} from '@/components/ResourceTable';
import {PageHeading,SectionHeading,MetricTile,Notice,InsetLink} from '@/components/WorkspaceUI';
import {safeDateLabel} from '@/lib/data.mjs';
import {countryName,targetSummary} from '@/lib/targeting.mjs';
import {LikelyTier} from '@/components/LikelyTier';
import type {Target} from '@/components/DiscoveryPreferences';

type Counts={companies:number;jobs:number;delivered:number;applications:number};
type BatchItem={rank:number;job_id:string;company_name:string;title:string;apply_url:string;published_at:string|null;
  eligibility_basis?:'official_posting'|'job_board'|'employer_worldwide';basis_source?:{name:string;url:string|null;worldwide:boolean}|null};

/** Job boards that supply location rules, with the credit link each board asks for. */
const BOARDS:Record<string,{label:string;home:string}>={
  himalayas:{label:'Himalayas',home:'https://himalayas.app'},
  remotive:{label:'Remotive',home:'https://remotive.com'},
  jobicy:{label:'Jobicy',home:'https://jobicy.com'},
  weworkremotely:{label:'We Work Remotely',home:'https://weworkremotely.com'},
};
/** Why this job is open to the applicant, and where that came from. */
function Basis({item,country}:{item:BatchItem;country:string}){
  if(item.eligibility_basis==='employer_worldwide')return <div className="basis">
    <span className="status status-worldwide" title={'The employer’s own job posting says the role is remote worldwide. It does not name '+country+'.'}>
      Employer says worldwide
    </span>
    <small>Official posting; doesn’t name {country}</small>
  </div>;
  if(item.eligibility_basis!=='job_board')return <div className="basis">
    <span className="status status-verified" title={'The employer’s own job posting explicitly accepts applicants in '+country}>
      <span aria-hidden="true">✓</span> Employer’s posting
    </span>
    <small>Names {country} in the official listing</small>
  </div>;
  const src=item.basis_source;
  const board=src?BOARDS[src.name]?.label??'job board':'job board';
  return <div className="basis">
    <span className="status status-board" title="Location rule published by a job board, not by the employer. Double-check on the posting.">
      {src?.worldwide?'Open worldwide':'Lists '+country}
    </span>
    <small>Per {src?.url?<a href={src.url} rel="noopener noreferrer" target="_blank">{board}<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span></a>:board}</small>
  </div>;
}
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dayLabel=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',weekday:'long',day:'numeric',month:'long'}).format(new Date());

export default function Overview(){
  const session=useCareerSession();
  const [generating,setGenerating]=useState(false);
  const [batchNotice,setBatchNotice]=useState('');
  const [batchError,setBatchError]=useState('');
  const stats=useResource<Counts>('metrics');
  const batch=useResource<{items:BatchItem[]}>('batches/'+day);
  const prefs=useResource<{target:Target|null}>('preferences');
  const target=prefs.data?.target??null;
  const country=countryName(target?.applicant_country)??'your country';
  const items=batch.data?.items??[];
  const boardsUsed=[...new Set(items.filter(i=>i.eligibility_basis==='job_board'&&i.basis_source&&BOARDS[i.basis_source.name])
    .map(i=>i.basis_source!.name))];
  async function generateBatch(){
    setGenerating(true);setBatchError('');setBatchNotice('');
    try{
      const result=await ciFetch<{inserted:number;note:string}>('batches/generate',session,{method:'POST'});
      setBatchNotice(result.inserted===0
        ?'No new roles passed every check. Broader role keywords, or “Any country” for employer headquarters, will find more.'
        :'Added '+result.inserted+' new '+(result.inserted===1?'role':'roles')+' to today’s list.');
      batch.reload();stats.reload();
    }catch(error){setBatchError(error instanceof Error?error.message:'Could not build today’s list');}
    finally{setGenerating(false);}
  }
  const metrics=[
    {label:'Employers found',value:stats.data?.companies??'—',hint:'From all connected sources'},
    {label:'Open job records',value:stats.data?.jobs??'—',hint:'Before eligibility checks'},
    {label:'Employers recommended',value:stats.data?.delivered??'—',hint:'Across all daily lists, never repeated'},
    {label:'Applications tracked',value:stats.data?.applications??'—',hint:'Recorded by you'},
  ];
  return <div className="overview-page">
    <PageHeading title="Your career, in focus." description="Roles that are open to you, why each one qualifies, and what needs your attention." meta={'WORKSPACE / '+dayLabel.toUpperCase()}
      action={<Link className="button-primary" href="/opportunities">Explore opportunities <span aria-hidden="true">→</span></Link>}/>
    <div className="target-strip" role="note">
      <span className="summary-indicator" aria-hidden="true"/>
      <span><span className="target-strip-label">Searching for</span>{prefs.loading?'Loading your settings…':targetSummary(target)}</span>
      <Link href="/settings">Change <span aria-hidden="true">→</span></Link>
    </div>
    {target?.employer_country&&<Notice title={'Employer headquarters is limited to '+countryName(target.employer_country)}>
      Jobs only qualify once that employer’s country is confirmed from its own website, which is rare, so your list may stay empty. <Link href="/settings" className="text-link">Set it to “Any country”</Link> to see every role open to you.
    </Notice>}
    <section aria-label="Workspace metrics" className="metric-layout">
      {metrics.map(metric=><MetricTile key={metric.label} {...metric}/>)}
    </section>
    <StateNotice loading={stats.loading} error={stats.error} retry={stats.reload}/>
    <div className="overview-columns">
      <section className="workspace-surface recommendations-surface">
        <SectionHeading title="Today’s list" description={'New roles you haven’t been sent before, added automatically through the day. Each row says why it’s open to applicants in '+country+'.'}
          action={<button type="button" className="button-secondary" disabled={generating} onClick={()=>void generateBatch()}
            title="The list builds at 07:00 Lagos time and tops itself up every hour. This checks right now.">{generating?'Checking…':'Check for new roles'}</button>}/>
        {batchNotice&&<Notice tone="success">{batchNotice}</Notice>}
        {batchError&&<Notice tone="danger">{batchError}</Notice>}
        <StateNotice loading={batch.loading} error={batch.error} retry={batch.reload}/>
        {batch.data&&<ResourceTable rowKey={r=>r.job_id} ariaLabel="Today’s recommended roles" items={items} columns={[
          {key:'company',label:'Employer',render:r=><div className="table-primary"><span className="company-avatar" aria-hidden="true">{r.company_name.charAt(0).toUpperCase()}</span><strong>{r.company_name}</strong></div>},
          {key:'job',label:'Role',render:r=><span className="role-name">{r.title}</span>},
          {key:'basis',label:'Why it’s open to you',render:r=><Basis item={r} country={country}/>},
          {key:'published',label:'Posted',render:r=><span className="muted">{safeDateLabel(r.published_at)}</span>},
          {key:'link',label:'',render:r=>r.apply_url?.startsWith('https://')
            ?<a href={r.apply_url} rel="noopener noreferrer" target="_blank" className="table-action">Apply<span className="sr-only"> to {r.title} at {r.company_name} (opens in a new tab)</span> <span aria-hidden="true">↗</span></a>
            :<span className="muted">No link</span>},
        ]} empty="No roles passed every check today. New search results arrive through the day; use “Check for new roles” or broaden your Search settings."/>}
        {items.length>0&&<dl className="basis-legend">
          <div><dt><span className="status status-verified">✓ Employer’s posting</span></dt><dd>The employer’s own listing names {country}. Strongest evidence.</dd></div>
          <div><dt><span className="status status-worldwide">Employer says worldwide</span></dt><dd>The employer’s own listing says remote worldwide but doesn’t name {country}. Worth confirming before applying.</dd></div>
          <div><dt><span className="status status-board">Job board</span></dt><dd>A job board (Himalayas, Remotive, Jobicy or We Work Remotely) says the role is open worldwide or lists {country}. Confirm on the posting before applying.</dd></div>
        </dl>}
        <div className="surface-foot">
          <InsetLink href="/opportunities">See all opportunities</InsetLink>
          {boardsUsed.length>0&&<span className="source-credit">Job-board listings from {boardsUsed.map((name,i)=><span key={name}>
            {i>0&&(i===boardsUsed.length-1?' and ':', ')}<a href={BOARDS[name].home} rel="noopener noreferrer" target="_blank">{BOARDS[name].label}</a></span>)}</span>}
        </div>
      </section>
      <aside className="overview-aside" aria-label="Next steps">
        <div className="next-steps-card">
          <span className="aside-kicker">YOUR WORKFLOW</span><h2>Keep things moving</h2><p>Pick up where you left off. Every step is under your control.</p>
          <div className="quick-links">
            <InsetLink href="/settings"><span><strong>Adjust search settings</strong><small>Country, role keywords and daily list size</small></span></InsetLink>
            <InsetLink href="/applications"><span><strong>Track applications</strong><small>Update the status of jobs you’ve applied to</small></span></InsetLink>
            <InsetLink href="/outreach"><span><strong>Prepare outreach</strong><small>Draft messages for sourced contacts</small></span></InsetLink>
            <InsetLink href="/knowledge"><span><strong>Review your knowledge base</strong><small>Keep your professional context current</small></span></InsetLink>
          </div>
        </div>
        <div className="principle-card"><span className="principle-symbol" aria-hidden="true">✓</span><div><h3>Research, not guesswork.</h3><p>A “remote” label alone never qualifies a job, every recommendation says where its evidence came from, and outreach is never sent automatically.</p></div></div>
      </aside>
    </div>
    <LikelyTier country={country} employerCountry={target?.employer_country??null}/>
  </div>;
}
