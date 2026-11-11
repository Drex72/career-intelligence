'use client';

import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {PageHeading} from '@/components/WorkspaceUI';
import {StateNotice} from '@/components/ResourceTable';
import {useCareerSession} from '@/components/AuthGate';
import {useResource} from '@/components/useResource';
import {ciFetch} from '@/lib/api';
import './factory.css';

type Stage='sources'|'registry'|'ingestion'|'eligibility'|'matching'|'ranking'|'delivery'|'knowledge'|'people'|'outreach'|'conversation';
type EventItem={
 id:string;run_id?:string|null;job_id?:string|null;stage:Stage;agent:string;type:string;
 input:Record<string,unknown>;output:Record<string,unknown>;time:string;kind:'instrumented'|'provenance';
};
type Role={role:string;total_tasks:number;active:boolean;latest_state:string;latest_at:string|null};
type WorkerRun={id:string;state:string;started_at:string;finished_at:string|null;details:Record<string,number>};
type FlowData={
 observed_at:string;poll_interval_ms:number;stage_counts:Partial<Record<Stage,number|null>>;
 source_records:number;evidence_records:number;review_pending:number;knowledge_documents:number;
 latest_batch:{date:string;state:string;target:number;delivered:number}|null;
 runs:WorkerRun[];roles:Role[];events:EventItem[];
 jobs:{id:string;title:string;company:string;status:string;published_at:string|null;first_seen_at:string}[];
 note:string;
};
type Snapshot={stage:Stage;time:string|null;before:Record<string,unknown>;after:Record<string,unknown>};
type JobLineage={
 job:{id:string;title:string;company:string;status:string;apply_url:string|null};
 snapshots:Snapshot[];events:EventItem[];tasks:{id:string;task_type:string;state:string}[];note:string;
};
type Node={id:Stage;x:number;y:number;name:string;agent:string;transform:string;input:string;output:string;kind:'processor'|'gate'|'agent'|'context'};
type Edge={from:Stage;to:Stage;path:string};
const WIDTH=1820,HEIGHT=655,NODE_WIDTH=206,NODE_HEIGHT=170;
const NODES:Node[]=[
 {id:'sources',x:36,y:132,name:'Public inputs',agent:'Discovery connectors',transform:'Ingest feed pages and linked employer board references.',input:'Remotive • Himalayas • ATS APIs',output:'Attributed source candidates',kind:'processor'},
 {id:'registry',x:291,y:132,name:'Source registry',agent:'ATS source gate',transform:'Check provider host, candidate approval and scan rate limit.',input:'Untrusted ATS source proposals',output:'Approved board identifiers',kind:'gate'},
 {id:'ingestion',x:546,y:132,name:'Normalize jobs',agent:'ATS ingestion worker',transform:'Normalize posting fields, validate IDs, deduplicate and preserve provenance.',input:'Provider-specific job JSON',output:'Canonical jobs + sources',kind:'processor'},
 {id:'eligibility',x:801,y:132,name:'Verify location',agent:'Eligibility specialist',transform:'Extract official job-scoped evidence, then classify Nigeria eligibility.',input:'Official ATS job + location text',output:'Verified / likely / unknown / excluded',kind:'gate'},
 {id:'matching',x:1056,y:132,name:'Match profile',agent:'Knowledge matching specialist',transform:'Compare approved knowledge to role and record supported skills and gaps.',input:'Eligible job + approved notes revision',output:'Score, matched skills, gaps',kind:'agent'},
 {id:'ranking',x:1311,y:132,name:'Policy + ranking',agent:'Preference & dedupe gate',transform:'Apply saved filters and evidence requirements, then rank eligible jobs.',input:'Verified roles + user preferences',output:'Qualifying opportunities',kind:'gate'},
 {id:'delivery',x:1566,y:132,name:'Daily dispatch',agent:'Batch delivery engine',transform:'Deduplicate employers across all deliveries and assemble the daily batch.',input:'Eligible undelivered employers',output:'Dashboard recommendations',kind:'processor'},
 {id:'knowledge',x:801,y:433,name:'Approved vault',agent:'Knowledge sync',transform:'Read owner-approved matching-safe knowledge; version and audit changes.',input:'Private Obsidian notes',output:'Approved knowledge revision',kind:'context'},
 {id:'people',x:1056,y:433,name:'People research',agent:'People specialist',transform:'Investigate public employee evidence for confirmed roles.',input:'Eligible company + role',output:'Public contacts and citations',kind:'agent'},
 {id:'outreach',x:1311,y:433,name:'Draft outreach',agent:'Outreach specialist',transform:'Prepare reviewable messages; owner approval required for any sending.',input:'Verified person + role context',output:'Drafts / approval records',kind:'gate'},
 {id:'conversation',x:1566,y:433,name:'Conversations',agent:'Conversation specialist',transform:'Track replies and next actions from recorded conversation evidence.',input:'Actual correspondence',output:'Conversation events',kind:'agent'}
];
const EDGES:Edge[]=[
 {from:'sources',to:'registry',path:'M242 215 H291'},
 {from:'registry',to:'ingestion',path:'M497 215 H546'},
 {from:'ingestion',to:'eligibility',path:'M752 215 H801'},
 {from:'eligibility',to:'matching',path:'M1007 215 H1056'},
 {from:'matching',to:'ranking',path:'M1262 215 H1311'},
 {from:'ranking',to:'delivery',path:'M1517 215 H1566'},
 {from:'knowledge',to:'matching',path:'M904 433 V331 Q904 321 914 321 H1139 Q1159 321 1159 302'},
 {from:'matching',to:'people',path:'M1192 302 V433'},
 {from:'people',to:'outreach',path:'M1262 516 H1311'},
 {from:'outreach',to:'conversation',path:'M1517 516 H1566'}
];
const ROLES=[
 {name:'discovery',node:'sources' as Stage,desc:'Public source discovery'},
 {name:'eligibility',node:'eligibility' as Stage,desc:'Official posting verification'},
 {name:'matching',node:'matching' as Stage,desc:'Approved-vault role scoring'},
 {name:'people',node:'people' as Stage,desc:'Employee / relationship research'},
 {name:'outreach',node:'outreach' as Stage,desc:'Human-approved drafting'},
 {name:'conversation',node:'conversation' as Stage,desc:'Replies and next actions'}
];
const nfmt=(v:number|null|undefined)=>v===null||v===undefined?'—':v.toLocaleString();
const pretty=(v:unknown)=>JSON.stringify(v??{},null,2);
const when=(s:string|null|undefined)=>s?new Date(s).toLocaleString():'Not recorded';
const rel=(s:string)=>{const d=Date.now()-Date.parse(s);if(d<0)return 'just now';if(d<60000)return Math.floor(d/1000)+'s ago';if(d<3600000)return Math.floor(d/60000)+'m ago';if(d<86400000)return Math.floor(d/3600000)+'h ago';return new Date(s).toLocaleDateString();};
function StationIcon({kind}:{kind:Node['kind']}){
 return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
 {kind==='gate'?<><path d="M12 2 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/></>:
 kind==='context'?<><path d="M4 5.5C7 4 10 4 12 6c2-2 5-2 8-.5V19c-3-1.5-6-1.5-8 .5-2-2-5-2-8-.5zM12 6v13.5"/></>:
 kind==='agent'?<><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M9 2v3m6-3v3M9 12h.01M15 12h.01M8 16h8"/></>:
 <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></>}
 </svg>;
}
export default function FactoryFlow(){
 const session=useCareerSession();
 const flow=useResource<FlowData>('flow');
 const [polling,setPolling]=useState(true);
 const [view,setView]=useState<'live'|'replay'>('live');
 const [selectedStage,setSelectedStage]=useState<Stage>('eligibility');
 const [eventIndex,setEventIndex]=useState(0);
 const [replayPlaying,setReplayPlaying]=useState(false);
 const [replaySpeed,setReplaySpeed]=useState(1);
 const [inspectorTab,setInspectorTab]=useState<'event'|'lineage'>('event');
 const [inspectorOpen,setInspectorOpen]=useState(false);
 const drawerCloseRef=useRef<HTMLButtonElement>(null);
 const drawerReturnFocusRef=useRef<HTMLElement|null>(null);
 const [selectedJob,setSelectedJob]=useState('');
 const [lineage,setLineage]=useState<JobLineage|null>(null);
 const [lineageError,setLineageError]=useState<string|null>(null);
 const [lineageBusy,setLineageBusy]=useState(false);
 const [zoom,setZoom]=useState(1);
 const [agentExpanded,setAgentExpanded]=useState(true);
 const [feedExpanded,setFeedExpanded]=useState(true);
 const scrollRef=useRef<HTMLDivElement>(null);
 const interval=flow.data?.poll_interval_ms??8000;
 useEffect(()=>{
   if(!inspectorOpen)return;
   drawerReturnFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
   drawerCloseRef.current?.focus();
   const handle=(event:KeyboardEvent)=>{
     if(event.key==='Escape')setInspectorOpen(false);
     if(event.key==='Tab'){
       const drawer=document.getElementById('factory-record-drawer');
       const controls=drawer?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href]');
       if(!controls?.length)return;
       const first=controls[0],last=controls[controls.length-1];
       if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
       else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
     }
   };
   window.addEventListener('keydown',handle);
   return ()=>{window.removeEventListener('keydown',handle);drawerReturnFocusRef.current?.focus();};
 },[inspectorOpen]);
 useEffect(()=>{
   if(!polling)return;
   const timer=setInterval(()=>flow.reload(),Math.max(5000,interval));
   return ()=>clearInterval(timer);
 },[polling,flow.reload,interval]);
 useEffect(()=>{
   if(!flow.data?.jobs?.length||selectedJob)return;
   setSelectedJob(flow.data.jobs[0].id);
 },[flow.data,selectedJob]);
 useEffect(()=>{
   if(!selectedJob){setLineage(null);return;}
   const ctl=new AbortController();
   setLineageBusy(true);setLineageError(null);
   ciFetch<JobLineage>('flow/jobs/'+selectedJob,session,{signal:ctl.signal}).then(v=>{
     if(!ctl.signal.aborted)setLineage(v);
   }).catch(e=>{if(!ctl.signal.aborted){setLineage(null);setLineageError(e instanceof Error?e.message:'Lineage unavailable');}})
    .finally(()=>{if(!ctl.signal.aborted)setLineageBusy(false);});
   return ()=>ctl.abort();
 },[selectedJob,session,flow.data?.observed_at]);
 const events=flow.data?.events||[];
 const replayEvent=events[Math.min(eventIndex,Math.max(0,events.length-1))];
 useEffect(()=>{
   if(view!=='replay'||!replayPlaying||events.length<2)return;
   const timer=setInterval(()=>setEventIndex(index=>index<=0?events.length-1:index-1),Math.max(350,1800/replaySpeed));
   return ()=>clearInterval(timer);
 },[view,replayPlaying,events.length,replaySpeed]);
 useEffect(()=>{
   if(view==='replay'&&replayPlaying&&replayEvent)setSelectedStage(replayEvent.stage);
 },[view,replayPlaying,replayEvent?.id]);
 const instrumentedRecent=useMemo(()=>events.filter(e=>
   e.kind==='instrumented'&&!['run_started','run_finished'].includes(e.type)&&Date.now()-Date.parse(e.time)<120000&&Date.now()>=Date.parse(e.time)-5000
 ),[events]);
 const liveRun=flow.data?.runs.some(r=>r.state==='running'&&!r.finished_at&&Date.now()-Date.parse(r.started_at)<900000)??false;
 const recentStages=new Set(instrumentedRecent.map(e=>e.stage));
 const highlighted=new Set<Stage>(view==='replay'&&replayEvent?[replayEvent.stage]:[...recentStages]);
 const stage= NODES.find(n=>n.id===selectedStage)||NODES[3];
 const selectedRole=ROLES.find(r=>r.node===selectedStage);
 const roleState=flow.data?.roles.find(x=>x.role===selectedRole?.name);
 const currentEvent=view==='replay'?replayEvent:events.find(e=>e.stage===selectedStage&&e.kind==='instrumented')||events.find(e=>e.stage===selectedStage)||events[0];
 const jobSnapshot=lineage?.snapshots.find(s=>s.stage===selectedStage)||lineage?.snapshots[0];
 const payloadBefore=inspectorTab==='event'?currentEvent?.input:jobSnapshot?.before;
 const payloadAfter=inspectorTab==='event'?currentEvent?.output:jobSnapshot?.after;
 function chooseEvent(index:number){
  setEventIndex(index);setView('replay');setReplayPlaying(false);setInspectorTab('event');setInspectorOpen(window.matchMedia('(max-width: 850px)').matches);
  const e=events[index];if(e){setSelectedStage(e.stage);if(e.job_id)setSelectedJob(e.job_id);}
 }
 function chooseStage(id:Stage){setSelectedStage(id);setInspectorTab('lineage');setInspectorOpen(window.matchMedia('(max-width: 850px)').matches);}
 function goToStage(){
   const item=NODES.find(n=>n.id===selectedStage);
   if(!item||!scrollRef.current)return;
   scrollRef.current.scrollTo({left:Math.max(0,(item.x+NODE_WIDTH/2)*zoom-scrollRef.current.clientWidth/2),behavior:'smooth'});
 }
 return <div className="factory-v2">
 <PageHeading meta="INTELLIGENCE SYSTEM / OBSERVABILITY" title="The factory floor" description="Watch your real source, normalization, verification and agent pipeline. Inspect how each recorded job changes as it moves between services." action={<div className="factory-heading-actions">
   <span className={'factory-live-pill '+(polling?'on':'off')}><span/>{polling?'Polling every '+Math.round(interval/1000)+'s':'Updates paused'}</span>
   <button className="button-secondary" type="button" onClick={()=>{flow.reload();}}>Refresh now</button>
 </div>}/>
 <StateNotice loading={!flow.data&&flow.loading} error={flow.error}/>
 <section className="factory-v2-summary" aria-label="Observed pipeline totals">
  {[
   {label:'Registered ATS boards',value:flow.data?.stage_counts.registry,icon:'◎'},
   {label:'Canonical jobs',value:flow.data?.stage_counts.ingestion,icon:'▤'},
   {label:'Eligibility evidence',value:flow.data?.evidence_records,icon:'◈'},
   {label:'Daily batch',value:flow.data?.latest_batch?.delivered??null,suffix:flow.data?.latest_batch?' / '+flow.data.latest_batch.target:'',icon:'↗'}
  ].map(item=><div className="factory-v2-metric" key={item.label}><span className="factory-v2-metric-icon" aria-hidden="true">{item.icon}</span><div><span>{item.label}</span><strong>{nfmt(item.value)}<small>{item.suffix}</small></strong></div></div>)}
 </section>
 <section className="factory-v2-main" aria-labelledby="flow-map-title">
  <header className="factory-v2-toolbar">
   <div><span className="factory-eyebrow">LIVE TOPOLOGY / 11 STATIONS</span><h2 id="flow-map-title">Processing network</h2><p>Click any station to inspect its execution, fields, and latest recorded transformations.</p></div>
   <div className="factory-v2-controls">
    <button className="factory-v2-ghost factory-v2-open-drawer" type="button" title="Open detailed before-and-after records" onClick={()=>setInspectorOpen(true)}>Inspect data <span aria-hidden="true">↗</span></button>
    <div className="factory-v2-segmented" role="group" aria-label="Chart playback mode">
     <button type="button" className={view==='live'?'active':''} aria-pressed={view==='live'} onClick={()=>{setView('live');setReplayPlaying(false);}}>Live map</button>
     <button type="button" className={view==='replay'?'active':''} aria-pressed={view==='replay'} onClick={()=>{setView('replay');setEventIndex(Math.max(0,events.length-1));setReplayPlaying(events.length>1);}}>Replay events</button>
    </div>
    <button type="button" className="factory-v2-iconbutton" aria-label={polling?'Pause polling':'Resume polling'} onClick={()=>setPolling(v=>!v)}>{polling?'Ⅱ':'▶'}</button>
    <div className="factory-v2-zoom" aria-label="Chart zoom controls">
     <button type="button" aria-label="Zoom out" onClick={()=>setZoom(v=>Math.max(.7,Number((v-.1).toFixed(2))))}>−</button><span>{Math.round(zoom*100)}%</span><button type="button" aria-label="Zoom in" onClick={()=>setZoom(v=>Math.min(1.3,Number((v+.1).toFixed(2))))}>+</button>
    </div>
    <button className="factory-v2-ghost" type="button" onClick={()=>{setZoom(1);scrollRef.current?.scrollTo({left:0,behavior:'smooth'});}}>Fit</button>
   </div>
  </header>
  <div className="factory-v2-workbench">
   <div className="factory-v2-graph-pane">
  <div className="factory-v2-viewport" ref={scrollRef} tabIndex={0} aria-label="Scrollable interactive dataflow graph; use the stage buttons to inspect">
   <div className="factory-v2-canvas-holder" style={{width:WIDTH*zoom,height:HEIGHT*zoom}}>
    <div className="factory-v2-canvas" style={{width:WIDTH,height:HEIGHT,transform:'scale('+zoom+')',transformOrigin:'top left'}}>
     <div className="factory-v2-lane first"><span>01 / PUBLIC SIGNALS</span><span>02 / CANONICAL PROCESSING & EVIDENCE</span></div>
     <div className="factory-v2-lane second"><span>PRIVATE KNOWLEDGE</span><span>03 / OPTIONAL SPECIALIST AGENTS · HUMAN APPROVAL</span></div>
     <svg className="factory-v2-edges" width={WIDTH} height={HEIGHT} viewBox={'0 0 '+WIDTH+' '+HEIGHT} aria-hidden="true">
      <defs><marker id="factory-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="#7ca8c4" strokeWidth="1.4"/></marker><marker id="factory-arrow-active" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="#73ebc5" strokeWidth="1.4"/></marker></defs>
      {EDGES.map((e,i)=>{
       const moving=highlighted.has(e.from)||highlighted.has(e.to);
       return <g key={e.from+'-'+e.to}>
        <path d={e.path} fill="none" className={'factory-v2-edge '+(moving?'moving':'')} markerEnd={moving?'url(#factory-arrow-active)':'url(#factory-arrow)'}/>
        {moving&&<circle r="4" className="factory-v2-packet" key={(view==='replay'?replayEvent?.id:'live')+'-'+i}><animateMotion dur={(2.4+i%3*.4)+'s'} repeatCount="indefinite" path={e.path}/></circle>}
       </g>;
      })}
     </svg>
     {NODES.map(n=>{
      const active=highlighted.has(n.id);
      const value=flow.data?.stage_counts[n.id];
      const role=ROLES.find(r=>r.node===n.id);
      const running=role&&flow.data?.roles.find(r=>r.role===role.name)?.active;
      return <button key={n.id} type="button" className={'factory-v2-node '+(selectedStage===n.id?'selected ':'')+(active?'pulsing ':'')+(running?'running':'')}
        style={{left:n.x,top:n.y,width:NODE_WIDTH,height:NODE_HEIGHT}} aria-pressed={selectedStage===n.id} aria-label={"Inspect "+n.name+": "+n.transform} data-tooltip={n.transform} onClick={()=>chooseStage(n.id)}>
        <span className="factory-v2-node-top"><span className={'factory-v2-node-icon kind-'+n.kind}><StationIcon kind={n.kind}/></span><span className="factory-v2-node-status"><i className={running?'active':active?'recent':''}/>{running?'Running':active?(view==='replay'?'Replay':'Observed'):'Idle'}</span></span>
        <strong>{n.name}</strong><small>{n.agent}</small>
        <span className="factory-v2-node-bottom"><span>{n.id==='registry'?'Sources':n.id==='eligibility'?'Assessments':n.id==='knowledge'?'Notes':n.id==='delivery'?'Delivered':'Records'}</span><b>{nfmt(value)}</b></span>
       </button>;
     })}
     <span className="factory-v2-canvas-note">Solid animation = instrumented recent activity or explicitly selected replay. Static connections = architectural paths, not proof of execution.</span>
    </div>
   </div>
  </div>
  <footer className="factory-v2-map-footer">
   <div><span className="factory-v2-legenddot recent"/><span>Observed activity</span><span className="factory-v2-legenddot archived"/><span>Idle path</span><span className="factory-v2-legenddot selected"/><span>Selected station</span></div>
   <button type="button" className="factory-v2-ghost" onClick={goToStage}>Center selected station ↗</button>
  </footer>
  {view==='replay'&&<div className="factory-v2-replay">
    <div><b>Historical event replay</b><span>{replayEvent?when(replayEvent.time)+' · '+replayEvent.agent:'No recorded events'}</span></div>
    <button type="button" className="factory-v2-replay-play" disabled={events.length<2} onClick={()=>setReplayPlaying(v=>!v)}>{replayPlaying?'Ⅱ Pause':'▶ Play'}</button>
    <input type="range" min={0} max={Math.max(0,events.length-1)} step={1} value={Math.min(eventIndex,Math.max(0,events.length-1))} disabled={!events.length} aria-label="Replay recorded event" onChange={e=>chooseEvent(Number(e.target.value))}/>
    <span>{events.length?String(Math.min(eventIndex+1,events.length))+' / '+events.length:'0 / 0'}</span>
    <select aria-label="Replay speed" value={replaySpeed} onChange={e=>setReplaySpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
  </div>}
   </div>

   <aside className="factory-v2-inspector-rail" aria-label="Selected station overview">
    <div className="factory-v2-inspector-rail-head">
     <div><span className="factory-eyebrow">SELECTED STATION</span><strong title={stage.name}>{stage.name}</strong></div>
     <span className="factory-v2-stage-chip">{stage.kind}</span>
    </div>
    <div className="factory-v2-compact-details">
     <div className="factory-v2-compact-agent" title={stage.agent}><span>Component</span><strong>{stage.agent}</strong></div>
     <div className="factory-v2-compact-flow"><span title={stage.input}><small>INPUT</small><b>{stage.input}</b></span><span className="factory-v2-compact-arrow" aria-hidden="true">↓</span><span title={stage.output}><small>OUTPUT</small><b>{stage.output}</b></span></div>
     <div className="factory-v2-compact-transform" title={stage.transform}><small>PROCESSING LOGIC</small><p>{stage.transform}</p></div>
     <div className="factory-v2-compact-stats"><div><small>Recorded events</small><strong>{events.filter(e=>e.stage===selectedStage).length}</strong></div><div><small>Specialist state</small><strong title={roleState?.latest_state||'Not applicable'}>{roleState?.latest_state?.replaceAll('_',' ')||'Not applicable'}</strong></div></div>
     <button type="button" className="factory-v2-inspect-cta" onClick={()=>setInspectorOpen(true)} title="Open full job lineage, execution events and JSON comparison">Inspect records &amp; JSON <span aria-hidden="true">↗</span></button>
    </div>
   </aside>
  </div>
 </section>
 <div className="factory-v2-grid">
  <section className="factory-v2-panel factory-v2-agents" aria-labelledby="agents-title">
   <div className="factory-v2-panel-header"><div><span className="factory-eyebrow">LANGGRAPH / 6 ROLES</span><h2 id="agents-title">Specialist agents</h2></div><button type="button" className="factory-v2-ghost" aria-expanded={agentExpanded} onClick={()=>setAgentExpanded(v=>!v)}>{agentExpanded?'Collapse':'Expand'}</button></div>
   <p className="factory-v2-panel-sub">These are the six configured graph roles. Execution status comes from actual workflow task records, not animation.</p>
   {agentExpanded&&<div className="factory-v2-agentlist">{ROLES.map((role,i)=>{
    const status=flow.data?.roles.find(r=>r.role===role.name);
    return <button type="button" key={role.name} className={'factory-v2-agent '+(selectedStage===role.node?'selected':'')} onClick={()=>chooseStage(role.node)}>
     <span className="factory-v2-agent-order">{String(i+1).padStart(2,'0')}</span>
     <span className="factory-v2-agent-info"><strong>{role.name.charAt(0).toUpperCase()+role.name.slice(1)} agent</strong><small>{role.desc}</small></span>
     <span className={'factory-v2-agent-status '+(status?.active?'busy':'')}>{status?.active?'RUNNING':status?.latest_state==='not_observed'?'NO RUN':(status?.latest_state||'NO DATA').toUpperCase()}</span>
    </button>;
   })}</div>}
   <div className="factory-v2-agent-caution">Worker functions can perform ingestion and eligibility without a separate LangGraph run. An idle role does not mean scheduled collection is broken.</div>
  </section>
 </div>
 <div className="factory-v2-grid lower">
  <section className="factory-v2-panel factory-v2-timeline" aria-labelledby="eventstream-title">
   <div className="factory-v2-panel-header"><div><span className="factory-eyebrow">OBSERVABILITY / TIMELINE</span><h2 id="eventstream-title">Processing events</h2></div><button type="button" className="factory-v2-ghost" aria-expanded={feedExpanded} onClick={()=>setFeedExpanded(v=>!v)}>{feedExpanded?'Hide feed':'Show feed'}</button></div>
   <p className="factory-v2-panel-sub">New instrumented events are recorded at execution time. Older events are provenance snapshots, labeled separately.</p>
   {feedExpanded&&<div className="factory-v2-eventlist">
    {events.slice(0,70).map((e,i)=><button key={e.id} type="button" className={'factory-v2-event '+(currentEvent?.id===e.id?'selected':'')} onClick={()=>chooseEvent(i)}>
     <span className={'factory-v2-event-bullet '+(e.kind==='instrumented'?'instrumented':'provenance')} aria-hidden="true"/>
     <span className="factory-v2-event-main"><strong>{e.type.replaceAll('_',' ')}</strong><small>{e.agent} · {e.stage}</small></span>
     <span className="factory-v2-event-right"><span>{rel(e.time)}</span><small>{e.kind==='instrumented'?'Worker trace':'DB record'}</small></span>
    </button>)}
    {flow.data&&events.length===0&&<p className="factory-v2-empty">No persisted transformation events yet. The pipeline may be idle; the next worker execution will emit structured telemetry.</p>}
   </div>}
  </section>
 </div>

 {inspectorOpen&&<div className="factory-v2-drawer-layer">
   <button type="button" className="factory-v2-drawer-scrim" aria-label="Close records drawer" onClick={()=>setInspectorOpen(false)}/>
   <aside id="factory-record-drawer" className="factory-v2-record-drawer" role="dialog" aria-modal="true" aria-labelledby="factory-drawer-title">
    <header className="factory-v2-record-drawer-head"><div><span className="factory-eyebrow">PROCESSING RECORDS / {selectedStage.toUpperCase()}</span><h2 id="factory-drawer-title" title={stage.name}>{stage.name}</h2><p title={stage.agent}>{stage.agent}</p></div>
      <button ref={drawerCloseRef} type="button" className="factory-v2-inspector-close" onClick={()=>setInspectorOpen(false)} aria-label="Close records drawer">×</button>
    </header>
    <div className="factory-v2-record-drawer-scroll">
     <section className="factory-v2-panel factory-v2-details" aria-labelledby="details-title">
       <div className="factory-v2-panel-header"><div><span className="factory-eyebrow">TRANSFORMATION</span><h2 id="details-title">Processing steps</h2></div><span className="factory-v2-stage-chip">{stage.kind}</span></div>
       <div className="factory-v2-transform-line"><div><span>INPUT</span><p>{stage.input}</p></div><span aria-hidden="true">→</span><div><span>TRANSFORM</span><p>{stage.transform}</p></div><span aria-hidden="true">→</span><div><span>OUTPUT</span><p>{stage.output}</p></div></div>
       <div className="factory-v2-details-meta"><div><span>Recorded events</span><strong>{events.filter(e=>e.stage===selectedStage).length}</strong></div><div><span>Specialist task</span><strong>{roleState?.latest_state?.replaceAll('_',' ')||'Not applicable'}</strong></div></div>
     </section>
     <section className="factory-v2-panel factory-v2-payload" aria-labelledby="payload-title">
       <div className="factory-v2-panel-header"><div><span className="factory-eyebrow">DATA SHAPE / BEFORE → AFTER</span><h2 id="payload-title">Transformation inspector</h2></div><div className="factory-v2-segmented" role="group" aria-label="Inspector data source"><button type="button" className={inspectorTab==='event'?'active':''} aria-pressed={inspectorTab==='event'} onClick={()=>setInspectorTab('event')}>Event</button><button type="button" className={inspectorTab==='lineage'?'active':''} aria-pressed={inspectorTab==='lineage'} onClick={()=>setInspectorTab('lineage')}>Job lineage</button></div></div>
       <div className="factory-v2-job-select"><label htmlFor="factory-job">Trace a job</label><select id="factory-job" value={selectedJob} onChange={e=>{setSelectedJob(e.target.value);setInspectorTab('lineage');}}><option value="">Select a stored job</option>{(flow.data?.jobs||[]).map(j=><option key={j.id} value={j.id}>{j.company} · {j.title}</option>)}</select></div>
       {inspectorTab==='lineage'&&<div className="factory-v2-snapshot-tabs" role="group" aria-label="Recorded job transformation stages">{(lineage?.snapshots||[]).map((s,i)=><button type="button" className={jobSnapshot===s?'active':''} key={s.stage+i} onClick={()=>setSelectedStage(s.stage)}>{s.stage.replaceAll('_',' ')}</button>)}{lineageBusy&&<span>Loading lineage…</span>}</div>}
       <div className="factory-v2-data-meta"><span>{inspectorTab==='event'?(currentEvent?currentEvent.type.replaceAll('_',' ')+' · '+when(currentEvent.time):'No event selected'):(jobSnapshot?jobSnapshot.stage+' · '+when(jobSnapshot.time):'No saved snapshot for this job')}</span><span>{inspectorTab==='event'&&currentEvent?.kind==='provenance'?'Historical record, not live agent output':inspectorTab==='event'?'Recorded event':'Persisted job data'}</span></div>
       {lineageError&&inspectorTab==='lineage'&&<p className="error-message">{lineageError}</p>}
       <div className="factory-v2-json-pair"><div className="factory-v2-codebox"><div className="factory-v2-codehead"><span>INPUT / BEFORE</span><span>JSON</span></div><pre>{pretty(payloadBefore)}</pre></div><div className="factory-v2-codebox after"><div className="factory-v2-codehead"><span>OUTPUT / AFTER</span><span>JSON</span></div><pre>{pretty(payloadAfter)}</pre></div></div>
       <p className="factory-v2-payload-note">Only stored, allowlisted metadata is shown. Raw ATS responses and private notes are not replayed.</p>
     </section>
    </div>
   </aside>
 </div>}

 <section className="factory-v2-bottom" aria-label="Runtime health">
  <div><span className="factory-v2-health-dot"/><span>Last API observation</span><strong>{when(flow.data?.observed_at)}</strong></div>
  <div><span>Latest signed worker</span><strong>{flow.data?.runs[0]?flow.data.runs[0].state+' · '+rel(flow.data.runs[0].started_at):'Not recorded'}</strong></div>
  <div><span>Pending official reviews</span><strong>{nfmt(flow.data?.review_pending)}</strong></div>
  <Link href="/operations">Open agent operations <span aria-hidden="true">↗</span></Link>
 </section>
 <p className="factory-v2-disclaimer">Live mode polls the owner-gated API every {Math.round(interval/1000)} seconds; it is not a continuously streamed socket. Animated packets appear for recently recorded worker stage events, or when you deliberately replay historical activity. They do not represent synthetic jobs or unobserved agent execution.</p>
 </div>;
}
