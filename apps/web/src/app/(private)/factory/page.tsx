'use client';
import Link from 'next/link';
import {useMemo,useState} from 'react';
import {PageHeading} from '@/components/WorkspaceUI';
import {StateNotice} from '@/components/ResourceTable';
import {useResource} from '@/components/useResource';

type Run={started_at:string;finished_at:string|null;state:string;details:Record<string,number>};
type Ops={states:Record<string,number>;delivery?:{date:string;delivered:number;target:number;state:string}|null;workerRuns?:Run[];readiness?:{discovered_jobs:number;source_records:number;open_jobs:number;recent_confirmed_publication:number;eligibility_assessments:number;eligibility_evidence:number;active_ats_boards:number;pending_source_candidates:number};integrity?:{approved_knowledge_documents:number;eligible_undelivered_jobs_now:number;integrity_ok:boolean}};
type Job={id:string;title:string;company_name:string;eligibility:string;source:string;match_score:number|null;source_url:string|null};
type Step={id:string;number:string;label:string;agent:string;input:string;transform:string;output:string;metric:string;value:number|null;href:string;detail:string;state:'live'|'gate'|'planned'};
const fmt=(n:number|null)=>n===null?'—':n.toLocaleString();
function StageIcon({name}:{name:string}){
 const common={width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
 const paths:Record<string,React.ReactNode>={
 source:<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h7"/></>,
 registry:<><path d="M3 7h18M6 3v4m12-4v4M4 7v13h16V7"/><path d="m9 14 2 2 4-4"/></>,
 worker:<><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4M1 15h4m14-6h4m-4 6h4"/></>,
 verify:<><path d="M12 2 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6z"/><path d="m8 12 3 3 5-6"/></>,
 match:<><circle cx="8" cy="8" r="3"/><circle cx="17" cy="16" r="3"/><path d="m10 11 4 3M3 20c0-4 2-6 5-6"/></>,
 rank:<><path d="M5 18V9m7 9V4m7 14v-7"/><path d="M2 21h20"/></>,
 batch:<><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18m-12-8v6m6-6v6"/></>,
 outreach:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></>
 };
 return <svg {...common} aria-hidden="true">{paths[name]||paths.source}</svg>;
}
export default function FactoryFlow(){
 const ops=useResource<Ops>('operations');
 const jobs=useResource<{jobs:Job[]}>('jobs');
 const knowledge=useResource<{documents:{path:string}[];last_sync?:{finished_at:string}|null}>('knowledge');
 const sources=useResource<{sources:{id:string;name:string;state:string;config:{provider:string;company_name:string}}[]}>('sources');
 const [selected,setSelected]=useState('verify');
 const [view,setView]=useState<'flow'|'runs'>('flow');
 const r=ops.data?.readiness, last=ops.data?.workerRuns?.[0], allJobs=jobs.data?.jobs||[];
 const verified=allJobs.filter(j=>j.eligibility==='verified_eligible').length;
 const likely=allJobs.filter(j=>j.eligibility==='likely_eligible').length;
 const unknown=allJobs.filter(j=>!j.eligibility||j.eligibility==='unknown').length;
 const matched=allJobs.filter(j=>typeof j.match_score==='number').length;
 const live=r!==undefined;
 const steps=useMemo<Step[]>(()=>[
  {id:'source',number:'01',label:'Inputs',agent:'External feeds + Obsidian',input:'Remotive · Himalayas · official ATS · approved notes',transform:'Receive attributed public vacancies and owner-approved knowledge.',output:'Source references + knowledge versions',metric:'Stored jobs',value:r?.discovered_jobs??null,href:'/opportunities',detail:'Public feeds and approved employer boards provide job leads. Your private approved Obsidian notes provide career context; notes do not become public job evidence.',state:'live'},
  {id:'registry',number:'02',label:'Source registry',agent:'Source discovery / owner approval',input:'ATS links + proposed employer boards',transform:'Validate provider and board identifiers, require source approval, enforce fixed public API hosts.',output:'Active ATS sources',metric:'Active ATS boards',value:r?.active_ats_boards??null,href:'/operations',detail:'Greenhouse, Lever, and Ashby boards have a separate approval gate. Pending suggestions cannot be scanned as trusted sources. Approval of a board does not verify the jobs on it.',state:'gate'},
  {id:'worker',number:'03',label:'Ingestion',agent:'Signed CI worker',input:'Approved boards + feed responses',transform:'Bounded fetch, provider rate limiting, normalization, canonical IDs and deduplication.',output:'Companies · jobs · job sources',metric:'Source records',value:r?.source_records??null,href:'/operations',detail:'An HMAC-authenticated worker fetches approved public endpoints, normalizes job records and persists their provenance. Failed provider calls and rejected rows are not counted as valid opportunities.',state:'live'},
  {id:'verify',number:'04',label:'Eligibility',agent:'Official job review',input:'Job ID + original employer posting',transform:'Extract posting description and structured location; classify evidence with conservative hiring rules.',output:'Verified · likely · unknown · ineligible',metric:'Assessments',value:r?.eligibility_assessments??null,href:'/operations',detail:'An official Nigeria hiring statement or job-scoped Nigeria location can establish verified eligibility. Worldwide wording alone is only likely eligible. Unsupported, stale or contradictory evidence cannot enter the verified delivery path.',state:'gate'},
  {id:'match',number:'05',label:'Knowledge matching',agent:'Approved-knowledge matcher',input:'Eligible job + matching-safe vault revision',transform:'Refresh verified handoffs, compare role requirements with approved experience, identify matching skills and gaps.',output:'Evidence-linked fit score and gaps',metric:'Visible match scores',value:jobs.data?matched:null,href:'/knowledge',detail:'Only matching-safe and agents-safe approved notes can inform the score. Matching tasks may have no result yet; absent scores are shown as missing, not zero. The architecture has a wider multi-agent design, but no independent six-agent execution should be inferred from this diagram.',state:'live'},
  {id:'rank',number:'06',label:'Preference gates',agent:'Ranking + policy checks',input:'Verified roles + fit + saved filters',transform:'Check job family, seniority, work mode, sponsorship constraints and recent publication.',output:'Eligible, preference-compatible pool',metric:'Qualified undelivered',value:ops.data?.integrity?.eligible_undelivered_jobs_now??null,href:'/operations',detail:'Ranking prioritizes available fit evidence. The delivery gate separately requires a current verified-eligible assessment, source evidence, current opening, recent published date, saved preferences and no lifetime repeat.',state:'gate'},
  {id:'batch',number:'07',label:'Daily delivery',agent:'Batch assembly',input:'Qualified and not previously delivered companies',transform:'Lifetime-deduplicate employers and jobs, then select up to the saved daily target.',output:'Today’s opportunities',metric:'Delivered in latest batch',value:ops.data?.delivery?.delivered??(ops.data?0:null),href:'/opportunities',detail:'Daily batch assembly is scheduled for 07:00 Africa/Lagos. Target is a ceiling, not a guarantee. Missing verified jobs produce an honest small or empty batch.',state:'live'},
  {id:'outreach',number:'08',label:'Human action',agent:'Application / outreach tools',input:'Reviewed jobs + contacts + owner decision',transform:'Track applications, prepare drafts and record responses; require separate authorization before sending.',output:'Applications · draft outreach · conversations',metric:'Delivery target',value:ops.data?.delivery?.target??null,href:'/outreach',detail:'This is a controlled downstream workspace. Gmail sending is not implied by an approved job, and the live worker does not send messages.',state:'gate'}
 ],[r,ops.data,jobs.data,matched]);
 const active=steps.find(s=>s.id===selected)||steps[3];
 function refresh(){ops.reload();jobs.reload();knowledge.reload();sources.reload();}
 return <div className="factory-page">
  <PageHeading meta="SYSTEM / LIVE DATAFLOW" title="The intelligence factory" description="Follow a job from public source to verified recommendation. Select any station to inspect its inputs, transformations, outputs and live signals." action={<button type="button" className="button-secondary" onClick={refresh}>↻ Refresh data</button>}/>
  <StateNotice loading={ops.loading||jobs.loading||sources.loading||knowledge.loading} error={ops.error||jobs.error||sources.error||knowledge.error}/>
  <div className="factory-summary" aria-label="Current system counters">
   <div><span>Approved ATS boards</span><strong>{fmt(r?.active_ats_boards??null)}</strong></div>
   <div><span>Stored opportunities</span><strong>{fmt(r?.discovered_jobs??null)}</strong></div>
   <div><span>Official assessments</span><strong>{fmt(r?.eligibility_assessments??null)}</strong></div>
   <div><span>Latest batch delivered</span><strong>{fmt(ops.data?.delivery?.delivered??null)}<small> / {fmt(ops.data?.delivery?.target??null)}</small></strong></div>
  </div>
  <section className="factory-board" aria-labelledby="factory-board-title">
   <header className="factory-board-head"><div><span className="factory-kicker">PIPELINE CONTROL ROOM</span><h2 id="factory-board-title">From signal to opportunity</h2><p>{live?'Observed values from your connected workspace. Counts are not additive between stations.':'Loading observed pipeline data; no placeholder counts are shown.'}</p></div>
    <div className="factory-switch" role="group" aria-label="View type"><button className={view==='flow'?'active':''} type="button" onClick={()=>setView('flow')} aria-pressed={view==='flow'}>Factory map</button><button className={view==='runs'?'active':''} type="button" onClick={()=>setView('runs')} aria-pressed={view==='runs'}>Worker runs</button></div>
   </header>
   {view==='flow'?<><div className="factory-rail" aria-label="Select pipeline processing station">
    {steps.map((s,i)=><div className="factory-rail-unit" key={s.id}><button type="button" className={'factory-station '+(selected===s.id?'selected':'')} aria-pressed={selected===s.id} onClick={()=>setSelected(s.id)}>
       <div className="factory-station-top"><span>{s.number} / {s.state==='gate'?'GATED':'LIVE PATH'}</span><StageIcon name={s.id}/></div>
       <strong>{s.label}</strong><small>{s.agent}</small><div className="factory-station-stat"><span>{s.metric}</span><b>{fmt(s.value)}</b></div>
      </button>{i<steps.length-1&&<div className="factory-connector" aria-hidden="true"><span>→</span></div>}</div>)}
   </div>
   <div className="factory-inspector" aria-live="polite"><div className="factory-inspector-copy">
    <div className="factory-kicker">STATION {active.number} / TRANSFORMATION DETAIL</div><h3>{active.label}</h3><p>{active.detail}</p>
    <Link href={active.href} className="factory-deep-link">Open related workspace <span aria-hidden="true">↗</span></Link>
   </div><div className="factory-transform">
    <div><span>INPUT</span><p>{active.input}</p></div><div className="factory-transform-arrow" aria-hidden="true">↓</div>
    <div className="factory-transform-work"><span>PROCESSING</span><p>{active.transform}</p></div><div className="factory-transform-arrow" aria-hidden="true">↓</div>
    <div><span>OUTPUT</span><p>{active.output}</p></div>
   </div></div></>:<div className="factory-run-list">
     {(ops.data?.workerRuns||[]).map((run,i)=><article key={i} className="factory-run"><div><strong>{run.state}</strong><span>{new Date(run.started_at).toLocaleString()}</span></div><div><span>Boards scanned</span><b>{run.details?.boards_scanned??'Not recorded'}</b></div><div><span>ATS jobs ingested</span><b>{run.details?.ats_jobs??0}</b></div><div><span>Reviews</span><b>{run.details?.reviewed??0}</b></div><div><span>Failures</span><b>{run.details?.failures??0}</b></div></article>)}
     {ops.data?.workerRuns?.length===0&&<p className="muted">No observed worker runs available.</p>}
    </div>}
  </section>
  <div className="factory-bottom">
   <section className="workspace-surface"><div className="section-title"><div><h2>Eligibility sorting line</h2><p className="muted">Current statuses across the jobs returned by the dashboard API, not all historical assessments.</p></div></div>
    <div className="factory-outcomes"><div className="verified"><strong>{jobs.data?verified:'—'}</strong><span>Verified eligible</span></div><div className="likely"><strong>{jobs.data?likely:'—'}</strong><span>Likely eligible</span></div><div><strong>{jobs.data?unknown:'—'}</strong><span>Unknown / unassessed</span></div><div className="ineligible"><strong>{jobs.data?allJobs.filter(j=>j.eligibility==='ineligible').length:'—'}</strong><span>Ineligible</span></div></div>
    <p className="factory-note">Only verified-eligible jobs with current evidence can reach the delivery stage. A record can have a valid source and still fail eligibility.</p>
   </section>
   <section className="workspace-surface"><div className="section-title"><div><h2>Factory inputs & controls</h2><p className="muted">Live registry and approved knowledge only.</p></div></div>
    <div className="factory-input-row"><span>ATS board registry</span><b>{sources.data?sources.data.sources.filter(s=>s.state==='active').length:'—'}</b></div>
    <div className="factory-input-row"><span>Approved knowledge documents</span><b>{knowledge.data?knowledge.data.documents.length:'—'}</b></div>
    <div className="factory-input-row"><span>Source candidates awaiting approval</span><b>{fmt(r?.pending_source_candidates??null)}</b></div>
    <div className="factory-input-row"><span>Latest worker run</span><b>{last?last.state:'Not recorded'}</b></div>
    <div className="factory-input-row"><span>Production integrity</span><b>{ops.data?.integrity?(ops.data.integrity.integrity_ok?'Passing':'Attention required'):'Not available'}</b></div>
    <Link className="factory-deep-link" href="/operations">Inspect agent operations ↗</Link>
   </section>
  </div>
 </div>;
}
