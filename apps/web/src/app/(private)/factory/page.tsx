'use client';
import Link from 'next/link';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {PageHeading} from '@/components/WorkspaceUI';
import {StateNotice} from '@/components/ResourceTable';
import {useResource} from '@/components/useResource';
import './discovery.css';

type Details={
 received?:number;normalized?:number;filtered?:number;rejected_role?:number;
 rejected_source?:number;rejected_stale?:number;not_selected?:number;
 save_failures?:number;remotive?:number;himalayas?:number;ats_jobs?:number;
 boards_scanned?:number;reviewed?:number;matched?:number;failures?:number;
 verified_eligible?:number;likely_eligible?:number;unknown?:number;ineligible?:number;
};
type Run={id:string;started_at:string;finished_at:string|null;state:string;details:Details|null};
type Trace={
 id:string;run_id?:string|null;job_id?:string|null;stage:string;agent:string;type:string;
 input:Record<string,unknown>;output:Record<string,unknown>;time:string;kind:string;
};
type PoolWave={id:number;observed_at:string;target:number;already_delivered:number;remaining:number;
 concurrency_ceiling:number;active_count:number;due_boards:number;pending_reviews:number;
 pending_matches:number;desired_instances:number;dispatched:number;decision:string};
type PoolInfo={config:{enabled:boolean;max_instances:number;reduced_instances:number;reduce_after_delivered:number;min_wave_interval_seconds:number}|null;waves:PoolWave[]};
type SpecialistRole='discovery'|'eligibility'|'matching'|'people'|'outreach'|'conversation';
type SpecialistLane={role:SpecialistRole;queued:number;active:number;desired:number;spawn:number;throughput_per_run:number;health_factor:number};
type SpecialistRun={id:string;role:SpecialistRole;state:string;started_at:string;finished_at:string|null;processed:number;failures:number};
type SpecialistInfo={config:{enabled:boolean;active_budget:number;dispatch_budget:number;interval_seconds:number}|null;
 waves:{id:number;observed_at:string;decision:string;total_launched:number;plan:{roles:SpecialistLane[];active_total:number;active_budget:number};dispatched:Record<string,number>}[];
 runs:SpecialistRun[]};
type Flow={
 observed_at:string;poll_interval_ms:number;events:Trace[];runs:Run[];
 roles:{role:string;latest_state:string;active:boolean;latest_at:string|null}[];
 jobs:{id:string;company:string;title:string}[];
 stage_counts:{registry?:number};latest_batch:{delivered:number;target:number}|null;
 worker_pool?:PoolInfo;
 specialist_pool?:SpecialistInfo;
};
type Breakdown={provider:string;board:string;company:string;received:number;accepted:number;ingested:number;
 rejected:number;role:number;source:number;stale:number;cap:number;time:string;id:string};
const number=(n:number|null|undefined)=>n==null?'—':n.toLocaleString();
const fullDate=(s:string)=>new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const safeNum=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)?value:0;
function StepIcon({name}:{name:'search'|'filter'|'check'|'arrow'}){
 return <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
  {name==='search'?<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>:name==='filter'?<><path d="M3 5h18l-7 8v6l-4 2v-8z"/></>:name==='check'?<><path d="M3 12 9 18 21 6"/></>:<><path d="M4 12h16m-7-6 7 6-7 6"/></>}
 </svg>;
}
const guide=[
 {title:'Start with a run',body:'A run is one real execution of the scheduled discovery worker. Select a recent run to see what happened during that execution.'},
 {title:'Follow the numbers',body:'Received means postings inspected. Passed means they met the initial title, source and age rules. Saved means the database accepted them.'},
 {title:'Investigate a decision',body:'Open a source row to see what was filtered out and why. Detailed eligibility and the technical agent map are available separately.'}
];
function FirstVisit({onDone}:{onDone:()=>void}){
 const [step,setStep]=useState(0);
 const skipRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{skipRef.current?.focus();},[]);
 return <div className="disc-tour-mask" role="presentation" onKeyDown={e=>{if(e.key==='Escape')onDone();}}>
  <section className="disc-tour" role="dialog" aria-modal="true" aria-labelledby="disc-tour-title">
   <div className="disc-tour-top"><span>GUIDED TOUR · {step+1} OF {guide.length}</span><button ref={skipRef} type="button" onClick={onDone}>Skip tour</button></div>
   <div className="disc-tour-illustration" aria-hidden="true">
    <span className={step===0?'active':''}>Pick a run</span><span className="disc-tour-line"/><span className={step===1?'active':''}>Follow jobs</span><span className="disc-tour-line"/><span className={step===2?'active':''}>See why</span>
   </div>
   <h2 id="disc-tour-title">{guide[step].title}</h2><p>{guide[step].body}</p>
   <div className="disc-tour-bottom"><div className="disc-tour-dots" aria-label="Tour progress">{guide.map((g,i)=><span key={i} className={i===step?'on':''}/>)}</div><div className="disc-tour-actions">{step>0&&<button type="button" className="disc-quiet" onClick={()=>setStep(v=>v-1)}>Back</button>}<button type="button" className="disc-primary" onClick={()=>step===guide.length-1?onDone():setStep(v=>v+1)}>{step===guide.length-1?'Explore the dashboard':'Next'}</button></div></div>
  </section>
 </div>;
}
export default function DiscoveryMonitor(){
 const resource=useResource<Flow>('flow');
 const [selected,setSelected]=useState('');
 const [onboard,setOnboard]=useState(false);
 const [expandedSource,setExpandedSource]=useState<string|null>(null);
 const [detailsOpen,setDetailsOpen]=useState(false);
 const [focusedLane,setFocusedLane]=useState<SpecialistRole|null>(null);
 const [tab,setTab]=useState<'sources'|'activity'>('sources');
 const [autoRefresh,setAutoRefresh]=useState(true);
 useEffect(()=>{try{setOnboard(localStorage.getItem('ci-discovery-tour-v1')!=='seen');}catch{}},[]);
 const finishTour=useCallback(()=>{setOnboard(false);try{localStorage.setItem('ci-discovery-tour-v1','seen');}catch{}},[]);
 useEffect(()=>{if(!autoRefresh)return;const t=setInterval(resource.reload,Math.max(5000,resource.data?.poll_interval_ms??8000));return()=>clearInterval(t);},[autoRefresh,resource.reload,resource.data?.poll_interval_ms]);
 const pool=resource.data?.worker_pool;
 const specialists=resource.data?.specialist_pool;
 const specialistWave=specialists?.waves?.[0];
 const wave=pool?.waves?.[0];
 const runs=resource.data?.runs??[];
 const run=runs.find(x=>x.id===selected)??runs[0];
 const data=run?.details??null;
 const records=useMemo(()=>resource.data?.events.filter(e=>e.kind==='instrumented'&&e.run_id===run?.id)??[],[resource.data?.events,run?.id]);
 const sources=useMemo<Breakdown[]>(()=>records.filter(e=>e.type==='source_screened').map(e=>({
  id:e.id,provider:String(e.input.provider||'ATS'),board:String(e.input.board||''),company:String(e.input.company||''),
  received:safeNum(e.input.received),accepted:safeNum(e.output.accepted),ingested:safeNum(e.output.ingested),
  rejected:safeNum(e.output.rejected),role:safeNum(e.output.rejected_role),
  source:safeNum(e.output.rejected_source),stale:safeNum(e.output.rejected_stale),
  cap:safeNum(e.output.not_selected),time:e.time
 })),[records]);
 const fullyMeasured=typeof data?.received==='number';
 const observedSources=sources.length>0;
 // Signed worker summaries appear on completion. During active runs, sum the
 // actual source-screened events already emitted, and label them "so far".
 const observed=(key:keyof Breakdown)=>sources.reduce((n,s)=>n+(typeof s[key]==='number'?s[key] as number:0),0);
 const hasFunnel=fullyMeasured||observedSources;
 const received=fullyMeasured?data!.received!:observedSources?observed('received'):null;
 const accepted=fullyMeasured?data!.normalized??null:observedSources?observed('accepted'):null;
 const excluded=fullyMeasured?data!.filtered??null:observedSources?observed('rejected'):null;
 const stored=fullyMeasured?(data!.remotive??0)+(data!.himalayas??0)+(data!.ats_jobs??0):observedSources?observed('ingested'):null;
 const reasons={
  role:fullyMeasured?data!.rejected_role??null:observedSources?observed('role'):null,
  source:fullyMeasured?data!.rejected_source??null:observedSources?observed('source'):null,
  stale:fullyMeasured?data!.rejected_stale??null:observedSources?observed('stale'):null
 };
 const running=run?.state==='running';
 const filterReasons=[
  {key:'role',label:'Not a relevant engineering role',value:reasons.role,description:'Job title did not satisfy the software/backend/AI engineering role rules.'},
  {key:'source',label:'Invalid or untrusted posting details',value:reasons.source,description:'Missing or malformed employer, posting identifier, or allowlisted job URL.'},
  {key:'stale',label:'Outside publication window',value:reasons.stale,description:'Published too long ago or dated implausibly into the future.'}
 ];
 const maxCount=Math.max(1,received??0);
 function openSource(id:string){setExpandedSource(v=>v===id?null:id);}
 return <div className="disc-page">
  <PageHeading meta="DISCOVERY / OBSERVE" title="Where did the jobs go?" description="Track one real discovery run, see which postings passed, and understand why others were excluded." action={<div className="disc-top-actions"><button type="button" className="disc-top-button" onClick={()=>setOnboard(true)}>How this works</button><Link className="disc-top-button" href="/factory/advanced">Technical map <span aria-hidden="true">↗</span></Link></div>}/>
  <StateNotice loading={!resource.data&&resource.loading} error={resource.error}/>
  <section className="disc-control" aria-label="Discovery run selector">
   <div className="disc-control-copy"><div className="disc-pulse" data-state={run?.state||'none'}/><div><strong>{running?'Discovery is running':run?'Selected discovery activity':'No worker runs yet'}</strong><p>{run?'Started '+fullDate(run.started_at)+' · '+run.state.replaceAll('_',' '):'Runs appear after the worker executes. It scans approved source APIs, not arbitrary sites.'}</p></div></div>
   <div className="disc-control-actions">
    <label htmlFor="disc-run-select">Run</label><select id="disc-run-select" value={run?.id??''} onChange={e=>{setSelected(e.target.value);setExpandedSource(null);}} disabled={!runs.length}>
     {runs.map((r,i)=><option key={r.id} value={r.id}>{i===0?'Latest · ':''}{fullDate(r.started_at)} · {r.state}</option>)}
    </select>
    <button className="disc-icon-button" type="button" title={autoRefresh?'Pause automatic refresh':'Resume automatic refresh'} aria-label={autoRefresh?'Pause automatic refresh':'Resume automatic refresh'} onClick={()=>setAutoRefresh(x=>!x)}>{autoRefresh?'Ⅱ':'▶'}</button>
    <button className="disc-icon-button" type="button" title="Refresh run data" onClick={resource.reload} aria-label="Refresh run data">↻</button>
   </div>
  </section>
  <section className="disc-specialists" aria-label="Specialist worker orchestration">
   <div className="disc-specialists-heading"><div><h2>Specialist orchestration</h2>
     <p>Each lane receives capacity based on its own ready work. Select a lane for individual worker runs.</p></div>
     <span className="disc-specialists-mode" data-active={specialists?.config?.enabled?'yes':'no'}>
       {specialists?.config?.enabled?'Adaptive allocation active':'Migration / activation pending'}</span>
   </div>
   <div className="disc-specialists-grid">
    {(['discovery','eligibility','matching','people','outreach','conversation'] as const).map((role)=>{
      const lane=specialistWave?.plan?.roles?.find(x=>x.role===role);
      const runs=specialists?.runs?.filter(x=>x.role===role)||[];
      const live=runs.filter(x=>x.state==='running').length;
      const labels:{[key in SpecialistRole]:string}={
       discovery:'Discovery',eligibility:'Eligibility',matching:'Matching',
       people:'People research',outreach:'Outreach drafts',conversation:'Conversations'};
      return <button type="button" key={role} className="disc-specialist-lane"
       onClick={()=>setFocusedLane(role)} title={'Inspect '+labels[role]+' workers and queue'}
       aria-label={'Inspect '+labels[role]+': '+(lane?.queued??0)+' queued, '+live+' running'}>
       <div className="disc-specialist-name"><strong>{labels[role]}</strong><span className={live>0?'disc-activity-live':'disc-activity-idle'}>{live>0?'Running':'Idle'}</span></div>
       <div className="disc-specialist-numbers">
        <div><b>{number(lane?.queued)}</b><small>Ready</small></div>
        <div><b>{number(lane?.desired)}</b><small>Needed</small></div>
        <div><b>{number(lane?.active)}</b><small>Active</small></div>
       </div>
       <div className="disc-specialist-foot"><span>Last launch {specialistWave?.dispatched?.[role]??0}</span><span aria-hidden="true">Inspect ↗</span></div>
      </button>;
    })}
   </div>
   <div className="disc-specialists-footer"><span>Measured from signed worker runs, source cooldowns and task queues.</span>
     <span>{specialistWave?fullDate(specialistWave.observed_at):'Awaiting first controller wave'}</span>
   </div>
  </section>
  {focusedLane&&<div className="disc-specialist-layer">
   <button type="button" className="disc-specialist-scrim" onClick={()=>setFocusedLane(null)} aria-label="Close specialist details"/>
   <aside role="dialog" aria-modal="true" aria-labelledby="disc-specialist-drawer-title" className="disc-specialist-drawer">
    <header><div><p>Specialist worker instances</p><h2 id="disc-specialist-drawer-title">{focusedLane.replaceAll('_',' ')} workers</h2></div>
       <button type="button" onClick={()=>setFocusedLane(null)} aria-label="Close details">×</button></header>
    <div className="disc-specialist-drawer-body">
     {(()=>{const lane=specialistWave?.plan?.roles?.find(x=>x.role===focusedLane);
      return <div className="disc-specialist-detail-counts"><span>Ready tasks: <b>{number(lane?.queued)}</b></span>
       <span>Calculated demand: <b>{number(lane?.desired)}</b></span>
       <span>Current active: <b>{number(lane?.active)}</b></span>
       <span>New requests: <b>{specialistWave?.dispatched?.[focusedLane]??0}</b></span></div>;})()}
     <h3>Recent actual executions</h3>
     {specialists?.runs?.filter(x=>x.role===focusedLane).length?
       specialists.runs.filter(x=>x.role===focusedLane).map(r=>
       <div className="disc-specialist-run" key={r.id}>
        <strong>{r.state.replaceAll('_',' ')}</strong><span>{fullDate(r.started_at)}</span>
        <small>{r.processed} processed · {r.failures} failures</small>
       </div>):<p className="disc-empty">No recorded executions for this specialist yet. No activity is simulated.</p>}
     <p className="disc-specialist-note">Capacity adapts to available work and recent worker health; an infrastructure request budget prevents runaway costs. No queued work means no new instances.</p>
    </div>
   </aside>
  </div>}
  <section className="disc-journey" aria-labelledby="disc-journey-title">
   <div className="disc-section-heading"><div><h2 id="disc-journey-title">Discovery at a glance</h2><p>Counts come from the selected worker run, not the whole database. In-progress runs update as sources finish.</p></div><span className="disc-label">{fullyMeasured?'MEASURED':running&&observedSources?'LIVE · SO FAR':observedSources?'PARTIAL EVENT RECORD':'HISTORICAL / LIMITED DATA'}</span></div>
   <div className="disc-funnel">
    <div className="disc-funnel-step disc-received"><span className="disc-step-icon"><StepIcon name="search"/></span><small>1 · RECEIVED</small><strong>{number(received)}</strong><span>Postings inspected</span></div>
    <span className="disc-funnel-arrow" aria-hidden="true"><StepIcon name="arrow"/></span>
    <div className="disc-funnel-step disc-passed"><span className="disc-step-icon"><StepIcon name="filter"/></span><small>2 · PASSED RULES</small><strong>{number(accepted)}</strong><span>Role, link &amp; freshness</span></div>
    <span className="disc-funnel-arrow" aria-hidden="true"><StepIcon name="arrow"/></span>
    <div className="disc-funnel-step disc-saved"><span className="disc-step-icon"><StepIcon name="check"/></span><small>3 · STORED</small><strong>{number(stored)}</strong><span>Accepted by database</span></div>
   </div>
   <div className="disc-funnel-outcome"><span className="disc-funnel-outcome-mark" aria-hidden="true">↳</span><strong>{number(excluded)} filtered out</strong><span>{hasFunnel?'The screening reasons are shown below.':'Earlier runs did not capture rejection counts. Values are not estimated.'}</span></div>
   {hasFunnel&&!fullyMeasured&&<div className="disc-measurement-note">These figures cover only the source events recorded so far. They may change as this run progresses and may omit older events outside the trace window.</div>}
   {fullyMeasured&&<div className="disc-funnel-caption">Stored counts successful ingestion or upserts, not guaranteed newly discovered unique jobs. Filtered means rejected by the initial source rules. {number(data?.not_selected??0)} additional passing posting(s) were beyond per-board processing limits. {number(data?.save_failures??0)} database write(s) failed. Neither is counted as a screening rejection.</div>}
   {!hasFunnel&&<div className="disc-measurement-note">Detailed discovery counts were introduced after this run. Select a newer measured run once one is available. Existing totals cannot be reconstructed reliably.</div>}
  </section>
  <div className="disc-work-grid">
   <section className="disc-panel disc-rejection-panel" aria-labelledby="disc-rejections-title">
    <div className="disc-panel-head"><div><h2 id="disc-rejections-title">Why postings were filtered</h2><p>Actual rejection reasons during initial screening.</p></div><button type="button" className="disc-help" title="These are title, source and publication checks. Eligibility verification happens later." aria-label="Explanation of initial screening">?</button></div>
    <div className="disc-reason-list">{filterReasons.map(reason=><div className="disc-reason" key={reason.key}>
      <div><strong title={reason.description}>{reason.label}</strong><b>{number(reason.value)}</b></div>
      <div className="disc-reason-track"><span style={{width:reason.value==null?'0%':Math.min(100,reason.value/maxCount*100)+'%'}}/></div>
    </div>)}</div>
    <button type="button" className="disc-text-action" onClick={()=>setDetailsOpen(true)}>What rules does discovery use? <span aria-hidden="true">↗</span></button>
   </section>
   <section className="disc-panel disc-sources-panel" aria-labelledby="disc-sources-title">
    <div className="disc-panel-head"><div><h2 id="disc-sources-title">Where it looked</h2><p>Per-source results from this run.</p></div><span className="disc-count-chip">{sources.length} source checks</span></div>
    {sources.length?<div className="disc-sources-list">{sources.map(source=><div className="disc-source-block" key={source.id}>
      <button className="disc-source-row" aria-expanded={expandedSource===source.id} onClick={()=>openSource(source.id)} type="button">
        <span className="disc-source-symbol">{source.provider.slice(0,1).toUpperCase()}</span>
        <span className="disc-source-name"><strong>{source.company||source.board||source.provider}</strong><small>{source.provider}{source.company&&source.board?' · '+source.board:''} · {source.received} inspected</small></span>
        <span className="disc-source-count">{source.ingested} stored</span>
        <span className="disc-source-chevron" aria-hidden="true">{expandedSource===source.id?'⌃':'⌄'}</span>
      </button>
      {expandedSource===source.id&&<div className="disc-source-expand">
        <div><span>Inspected</span><b>{source.received}</b></div><div><span>Passed</span><b>{source.accepted}</b></div><div><span>Rejected</span><b>{source.rejected}</b></div><div><span>Stored</span><b>{source.ingested}</b></div>
        <p>Rejected: {source.role} role mismatch · {source.source} invalid source · {source.stale} outside date window. {source.cap?source.cap+' passed the rules but exceeded the processing cap.':''}</p>
        {records.filter(e=>e.type==='posting_filtered'&&String(e.input.provider||'')===source.provider&&String(e.input.board||'')===source.board).slice(0,3).length>0&&
         <div className="disc-source-examples"><strong>Examples of screened-out postings</strong>
          {records.filter(e=>e.type==='posting_filtered'&&String(e.input.provider||'')===source.provider&&String(e.input.board||'')===source.board).slice(0,3).map(e=><div key={e.id}>
           <span title={String(e.input.title||'')}>{String(e.input.title||'Untitled posting')}</span>
           <small>{String(e.output.reason||'filtered')}</small>
          </div>)}
         </div>}
      </div>}
     </div>)}</div>:<div className="disc-empty">{hasFunnel&&received===0?'This worker run inspected no postings. Approved feeds or ATS boards may still be within their rate-limit cooldown.':hasFunnel?'The run has counts, but its source-level events are missing from the recent trace window.':'Older runs did not capture per-source screening details.'}</div>}
   </section>
  </div>
  <section className="disc-panel disc-results" aria-labelledby="disc-results-title">
   <div className="disc-panel-head"><div><h2 id="disc-results-title">What happened after discovery?</h2><p>Saved jobs enter eligibility checks; a matching role is not automatically eligible for you.</p></div>
    <div className="disc-tabs" role="group" aria-label="Discovery details">
     <button type="button" className={tab==='sources'?'active':''} aria-pressed={tab==='sources'} onClick={()=>setTab('sources')}>Run outcomes</button>
     <button type="button" className={tab==='activity'?'active':''} aria-pressed={tab==='activity'} onClick={()=>setTab('activity')}>Activity log</button>
    </div>
   </div>
   {tab==='sources'?<div className="disc-outcomes">
    <div><small>Saved jobs</small><strong>{number(stored)}</strong><span>Accepted database ingestions; may update existing jobs</span></div>
    <div><small>Official eligibility reviews</small><strong>{number(data?.reviewed)}</strong><span>From the review queue, not necessarily the same new jobs</span></div>
    <div><small>Confirmed eligible</small><strong>{number(data?.verified_eligible)}</strong><span>Official job-scoped evidence; not a guarantee of delivery</span></div>
    <div><small>Profile matches</small><strong>{number(data?.matched)}</strong><span>Requires approved knowledge and eligible handoff</span></div>
   </div>:<div className="disc-activity">
    {records.length?records.slice().reverse().slice(-35).reverse().map(event=><div key={event.id}><span className="disc-activity-dot"/><div><strong>{event.type.replaceAll('_',' ')}</strong><span>{event.agent.replaceAll('_',' ')} · {fullDate(event.time)}</span></div><span className="disc-activity-stage">{event.stage}</span></div>):<p>No instrumented events recorded for this run.</p>}
   </div>}
   <div className="disc-end-actions"><Link href="/opportunities">Review opportunities <span aria-hidden="true">↗</span></Link><Link href="/factory/advanced">Explore all agents and job lineage <span aria-hidden="true">↗</span></Link></div>
  </section>
  {detailsOpen&&<div className="disc-dialog-mask" onMouseDown={e=>{if(e.currentTarget===e.target)setDetailsOpen(false);}}>
    <div className="disc-dialog" role="dialog" aria-modal="true" aria-labelledby="disc-rules-title">
     <header><div><h2 id="disc-rules-title">How filtering works</h2><p>These rules run before eligibility or profile matching.</p></div><button type="button" aria-label="Close filtering explanation" onClick={()=>setDetailsOpen(false)}>×</button></header>
     <div className="disc-rules-body"><article><b>1. Relevant engineering title</b><p>Look for software, backend, frontend, platform, infrastructure, cloud, security or AI engineering roles. Unrelated or generic titles are screened out.</p></article><article><b>2. Valid original listing</b><p>Require a valid provider-specific posting identifier, company details and a permitted HTTPS posting URL. Public sources are not automatically approved ATS boards.</p></article><article><b>3. Publication window</b><p>Skip old or implausibly future-dated postings. Feed windows and official ATS windows differ by provider.</p></article><article><b>4. Resource and evidence gates</b><p>Approved boards have scan limits and per-board processing caps. Official eligibility verification is a separate step. An accepted job is not necessarily available to a Nigerian applicant.</p></article></div>
    </div>
   </div>}
  {onboard&&<FirstVisit onDone={finishTour}/>}
 </div>;
}
