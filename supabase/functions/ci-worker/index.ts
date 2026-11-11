// Private unattended Career Intelligence worker.
// verify_jwt=false only for this distinct function; every request must pass
// a DB-backed, HMAC-authenticated, short-lived nonce gate before any work.
// All network destinations are fixed public source APIs. Never send email.
import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {validEnvelope,MAX_BODY_BYTES,MAX_BOARDS_PER_RUN,MAX_ATS_JOBS_PER_BOARD,MAX_REVIEWS_PER_RUN,selectDueSources,claimDueBoardBatch} from './policy.mjs';
import {boardEndpoint,analyzeBoard,validBoard} from './ats.mjs';
import {candidateBoards} from './candidates.mjs';
import {classifyOfficialPosting,findOfficialJob,postingDescription,postingLocation} from './eligibility.mjs';
import {classifyWorkFacts} from './work-facts.mjs';
import {scoreApprovedMatch,approvedRevision} from './matching.mjs';
import {safePreview} from './telemetry.mjs';
import {runPeople,runOutreach,runConversation} from './specialists.mjs';
import {analyzeHimalayas,safeHimalayasCursor,isSoftwareRole} from './himalayas.mjs';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
function checked<T>(result:{data:T,error:unknown}):T{
  if(result.error)throw new Error('internal database operation failed');
  return result.data;
}
function rows<T>(value:T[]|null|undefined):T[]{return value||[];}
const now=()=>Date.now();
async function fetchJSON(url:string,timeout=12000):Promise<any>{
  const response=await fetch(url,{
    redirect:'error',signal:AbortSignal.timeout(timeout),
    headers:{'Accept':'application/json','User-Agent':'CareerIntelligenceScheduledResearch/0.7'}
  });
  if(!response.ok)throw new Error('public source unavailable');
  if(Number(response.headers.get('content-length')||0)>2_000_000)throw new Error('source too large');
  const raw=await response.text();
  if(raw.length>2_000_000)throw new Error('source too large');
  return JSON.parse(raw);
}
function remotiveRole(job:any,stamp:number){
  const title=String(job?.title||'').trim();
  const company=String(job?.company_name||'').trim();
  const id=String(job?.id||'');
  const published=String(job?.publication_date||'');
  const normalized=published&&/(?:Z|[+-]\d\d:\d\d)$/.test(published)?published:published+'Z';
  const time=Date.parse(normalized);
  let u:URL;
  try{u=new URL(String(job?.url||''));}catch{return null;}
  if(!/^\d{1,30}$/.test(id)||company.length<2||company.length>180||
     title.length<3||title.length>250 ||
     !isSoftwareRole(title)||
     u.protocol!=='https:'||u.hostname!=='remotive.com'||!u.pathname.startsWith('/remote-jobs/')||
     u.username||u.password||u.port||!Number.isFinite(time)||
     time<stamp-7*86400_000||time>stamp+86400_000)return null;
  return {id,title,company,url:u.origin+u.pathname,published:new Date(time).toISOString(),
    location:String(job?.candidate_required_location||'').slice(0,500),
    description:job?.description};
}

Deno.serve(async (request:Request)=>{
  if(request.method!=='POST')return response(405,{error:'Method not allowed'});
  if(Number(request.headers.get('content-length')||0)>MAX_BODY_BYTES)
    return response(413,{error:'Request too large'});
  let envelope:any;
  try{
    const body=await request.text();
    if(body.length>MAX_BODY_BYTES)return response(413,{error:'Request too large'});
    envelope=JSON.parse(body);
  }catch{return response(401,{error:'Signed request required'});}
  if(!validEnvelope(envelope))return response(401,{error:'Signed request required'});
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return response(503,{error:'Worker storage not configured'});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const role=typeof envelope.role==='string'?envelope.role:'legacy';
  let authorized=false;
  try{
    if(role==='legacy'){
      authorized=checked(await db.rpc('ci_verify_worker_request',{
        p_nonce:envelope.nonce,p_timestamp:envelope.timestamp,p_signature:envelope.signature
      }))===true;
    }else{
      authorized=checked(await db.rpc('ci_verify_specialist_request',{
        p_nonce:envelope.nonce,p_timestamp:envelope.timestamp,
        p_signature:envelope.signature,p_role:role
      }))===true;
    }
  }catch{return response(503,{error:'Worker authorization temporarily unavailable'});}
  if(!authorized)return response(401,{error:'Invalid or replayed signed request'});

  let runID:string|undefined;
  let eventCount=0;
  // Append immutable, sanitized transformation breadcrumbs while work is running.
  // Telemetry must not block discovery or turn failed trace writes into fake job failures.
  async function recordStage(stage:string,agent:string,eventType:string,input:Record<string,unknown>,
    output:Record<string,unknown>,jobId?:string){
    if(!runID||eventCount>=120)return;
    eventCount++;
    const payload:any={worker_run_id:runID,stage,agent,event_type:eventType,
      input_preview:safePreview(input),output_preview:safePreview(output)};
    if(jobId&&/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(jobId))payload.job_id=jobId;
    const saved=await db.from('ci_pipeline_events').insert(payload);
    if(saved.error)report.telemetry_failures++;
  }
  const report={remotive:0,himalayas:0,ats_jobs:0,boards_scanned:0,reviewed:0,verified_eligible:0,likely_eligible:0,unknown:0,ineligible:0,candidates:0,matched:0,
    attempts:0,failures:0,telemetry_failures:0,received:0,normalized:0,filtered:0,
    rejected_role:0,rejected_source:0,rejected_stale:0,not_selected:0,save_failures:0,
    people_processed:0,drafts_prepared:0,replies_classified:0};
  try{
    const run=checked(await db.from('ci_worker_runs')
      .insert({state:'running',specialist_role:role==='legacy'?null:role}).select('id').single());
    runID=run.id;
    await recordStage('sources','signed_ci_worker','run_started',
      {format:'signed_worker_request',role},{status:'running'});
    if(role==='legacy'||role==='discovery'){
    // One feed request per six hours, matching provider's published guidance.
    const allowed=checked(await db.rpc('ci_claim_feed_slot',{p_action:'remotive'}));
    if(allowed){
      report.attempts++;
      try{
        const feed=await fetchJSON('https://remotive.com/api/remote-jobs?category=software-dev&limit=100',15000);
        if(!Array.isArray(feed?.jobs))throw new Error('feed format changed');
        const sourceRows=feed.jobs.slice(0,100);
        report.received+=sourceRows.length;
        let remotiveNormalized=0;
        const remotiveExamples=[];
        for(const job of sourceRows){
          // Match the current role rule separately so the user can see why titles were skipped.
          const roleOK=isSoftwareRole(job?.title);
          const entry=remotiveRole(job,now());
          if(!entry){
            report.filtered++;
            let reason='source';
            if(!roleOK)reason='role';
            else {
              const published=String(job?.publication_date||'');
              const stamp=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(published)?published:published+'Z');
              if(!Number.isFinite(stamp)||stamp<now()-7*86400_000||stamp>now()+86400_000)reason='stale';
            }
            if(reason==='role')report.rejected_role++;
            else if(reason==='stale')report.rejected_stale++;
            else report.rejected_source++;
            if(remotiveExamples.length<3)remotiveExamples.push({reason,title:String(job?.title||'').slice(0,180)});
            continue;
          }
          report.normalized++;remotiveNormalized++;
          const saved=await db.rpc('ci_ingest_remotive_job',{
            p_source_id:entry.id,p_company:entry.company,p_title:entry.title,
            p_url:entry.url,p_published_at:entry.published,p_location:entry.location
          });
          if(saved.error||!saved.data){report.failures++;report.save_failures++;continue;}
          report.remotive++;
          if(report.candidates<10){
            for(const candidate of candidateBoards(entry.description,entry.company,entry.url)){
              const proposed=await db.rpc('ci_suggest_ats_board',{
                p_provider:candidate.provider,p_board_slug:candidate.slug,
                p_company_name:candidate.company,p_evidence_url:candidate.evidenceURL
              });
              if(!proposed.error&&proposed.data)report.candidates++;
              if(report.candidates>=10)break;
            }
          }
        }
        for(const example of remotiveExamples)await recordStage('sources','remotive_filter','posting_filtered',
          {provider:'remotive',title:example.title,format:'remote_feed'},
          {reason:example.reason,status:'rejected'});
        await recordStage('sources','remotive_feed','source_screened',
          {provider:'remotive',format:'remote_feed',received:sourceRows.length},
          {accepted:remotiveNormalized,ingested:report.remotive,rejected:sourceRows.length-remotiveNormalized,
           rejected_role:report.rejected_role,rejected_source:report.rejected_source,
           rejected_stale:report.rejected_stale,format:'normalized_job'});
      }catch{report.failures++;}
    }
    // Himalayas API refreshes once daily. Respect its shared unauthenticated
    // quota and keep official Apply URLs and provider attribution unchanged.
    const himalayasSlot=checked(await db.rpc('ci_claim_feed_slot',{p_action:'himalayas'}));
    if(himalayasSlot){
      let cursor:string|null=null;
      const seenCursors=new Set<string>();
      for(let pageIndex=0;pageIndex<3;pageIndex++){
        report.attempts++;
        try{
          const endpoint='https://himalayas.app/jobs/api?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
          const page=await fetchJSON(endpoint);
          const audit=analyzeHimalayas(page);
          const jobs=audit.jobs;
          report.received+=audit.scanned;
          report.normalized+=jobs.length;
          report.filtered+=audit.scanned-jobs.length;
          report.rejected_role+=audit.excluded.role;
          report.rejected_source+=audit.excluded.source;
          report.rejected_stale+=audit.excluded.stale;
          const priorIngested=report.himalayas;
          for(const job of jobs){
            const saved=await db.rpc('ci_ingest_himalayas_job',{
              p_guid:job.guid,p_company:job.company,p_title:job.title,
              p_application_link:job.applicationLink,p_published_at:job.lastUpdatedAt,
              p_locations:job.locations
            });
            if(saved.error||!saved.data){report.failures++;report.save_failures++;continue;}
            report.himalayas++;
            // An official ATS application link is a proposal, not verified employer identity.
            // The user must approve it in the source-candidate queue before scanning.
            if(report.candidates<10){
              for(const candidate of candidateBoards(job.applicationLink+' '+job.description,job.company,job.guid)){
                const proposed=await db.rpc('ci_suggest_ats_board',{
                  p_provider:candidate.provider,p_board_slug:candidate.slug,
                  p_company_name:candidate.company,p_evidence_url:candidate.evidenceURL
                });
                if(!proposed.error&&proposed.data)report.candidates++;
                if(report.candidates>=10)break;
              }
            }
          }
          for(const example of audit.samples)await recordStage('sources','himalayas_filter','posting_filtered',
            {provider:'himalayas',title:example.title,format:'remote_feed'},
            {reason:example.reason,status:'rejected'});
          await recordStage('sources','himalayas_feed','source_screened',
            {provider:'himalayas',format:'remote_feed',received:audit.scanned},
            {accepted:jobs.length,ingested:report.himalayas-priorIngested,
             rejected:audit.scanned-jobs.length,rejected_role:audit.excluded.role,
             rejected_source:audit.excluded.source,rejected_stale:audit.excluded.stale,
             format:'normalized_job'});
          const next=safeHimalayasCursor(page?.nextCursor,seenCursors);
          if(!next)break;
          seenCursors.add(next);
          cursor=next;

        }catch{report.failures++;break;}
      }
    }
    const [active,limits]=await Promise.all([
      db.from('ci_discovery_sources').select('id,name,kind,state,config')
        .eq('kind','ats').eq('state','active').limit(200),
      db.from('ci_api_rate_limits').select('action,last_run_at')
        .like('action','ats:ats:%').limit(500)
    ]);
    // Look beyond the first six: concurrent workers must not all fight for
    // the same board IDs. Each claims up to six distinct boards before fetch.
    const dueBoards=selectDueSources(rows(checked(active)),rows(checked(limits)),now(),200);
    const boards=await claimDueBoardBatch(dueBoards,async board=>{
      const cfg=board.config;
      if(!validBoard({provider:cfg.provider,slug:cfg.slug,company:cfg.company_name}))return false;
      const claimed=await db.rpc('ci_claim_ats_slot',{p_source_id:board.id});
      return !claimed.error&&claimed.data===true;
    },MAX_BOARDS_PER_RUN);
    for(const board of boards){
      const cfg=board.config;
      report.attempts++;
      await recordStage('registry','ats_source_gate','board_claimed',
        {provider:cfg.provider,board:cfg.slug,format:'approved_board'},
        {approved:true,format:'provider_api'});
      try{
        const result=await fetchJSON(boardEndpoint(cfg.provider,cfg.slug));
        cached.set(board.name,result);
        report.boards_scanned++;
        const audit=analyzeBoard(result,cfg.provider,cfg.slug,cfg.company_name);
        const candidates=audit.jobs;
        const shortlisted=candidates.slice(0,MAX_ATS_JOBS_PER_BOARD);
        report.received+=audit.scanned;
        report.normalized+=candidates.length;
        report.filtered+=audit.scanned-candidates.length;
        report.rejected_role+=audit.excluded.role;
        report.rejected_source+=audit.excluded.source;
        report.rejected_stale+=audit.excluded.stale;
        report.not_selected+=Math.max(0,candidates.length-shortlisted.length);
        const priorIngested=report.ats_jobs;
        let sampledPostings=0;
        for(const candidate of shortlisted){
          const saved=await db.rpc('ci_ingest_ats_job',{
            p_provider:candidate.provider,p_board:candidate.board,
            p_source_job_id:candidate.sourceJobId,p_company:candidate.company,
            p_title:candidate.title,p_url:candidate.url,
            p_published_at:candidate.publishedAt,p_remote_text:candidate.remoteText
          });
          if(!saved.error&&saved.data){
            report.ats_jobs++;
            if(sampledPostings++<5)await recordStage('ingestion','ats_normalizer','posting_saved',
              {provider:candidate.provider,board:candidate.board,
               source_job_id:candidate.sourceJobId,format:'provider_posting'},
              {company:candidate.company,title:candidate.title,location:candidate.remoteText,
               job_id:typeof saved.data==='string'?saved.data:'',
               saved:true,format:'canonical_job'},
              typeof saved.data==='string'?saved.data:undefined);
          }else{report.failures++;report.save_failures++;}
        }
        for(const example of audit.samples)await recordStage('ingestion','ats_filter','posting_filtered',
          {provider:cfg.provider,board:cfg.slug,title:example.title,format:'provider_posting'},
          {reason:example.reason,status:'rejected'});
        await recordStage('ingestion','ats_normalizer','source_screened',
          {provider:cfg.provider,board:cfg.slug,company:cfg.company_name,format:'provider_posting',received:audit.scanned},
          {accepted:candidates.length,ingested:report.ats_jobs-priorIngested,
           rejected:audit.scanned-candidates.length,rejected_role:audit.excluded.role,
           rejected_source:audit.excluded.source,rejected_stale:audit.excluded.stale,
           not_selected:candidates.length-shortlisted.length,format:'canonical_job'});
      }catch{report.failures++;}
    }
    }
    const cached=new Map<string,unknown>();
    if(role==='legacy'||role==='eligibility'){
    // Deterministic official evidence checks; never infer Nigeria from "remote" alone.
    const queue=rows(checked(await db.from('ci_eligibility_review_queue')
      .select('job_id').eq('state','pending').order('first_queued_at').limit(100)));
    let reviewAttempts=0;
    for(const item of queue){
      if(reviewAttempts>=MAX_REVIEWS_PER_RUN)break;
      const sources=rows(checked(await db.from('ci_job_sources')
        .select('source_name,source_job_id,source_url').eq('job_id',item.job_id)
        .in('source_name',['greenhouse','lever','ashby']).limit(5)));
      let chosen:any=null;
      for(const source of sources){
        const id=String(source.source_job_id||'');
        const split=id.indexOf(':');
        if(split<1)continue;
        const slug=id.slice(0,split),sourceJob=id.slice(split+1);
        const key='ats:'+source.source_name+':'+slug;
        const sourceBoard=rows(checked(await db.from('ci_discovery_sources')
          .select('config').eq('name',key).eq('kind','ats').eq('state','active').limit(1)))[0];
        const c=sourceBoard?.config;
        if(c&&validBoard({provider:c.provider,slug:c.slug,company:c.company_name})&&
          c.slug===slug&&c.provider===source.source_name&&/^[A-Za-z0-9_-]{1,150}$/.test(sourceJob)){
          chosen={sourceURL:source.source_url,provider:c.provider,slug:c.slug,id:sourceJob,key};break;
        }
      }
      if(!chosen)continue;
      const claimed=await db.rpc('ci_claim_job_review_slot',{p_job_id:item.job_id});
      if(claimed.error||!claimed.data)continue;
      reviewAttempts++;
      report.attempts++;
      try{
        const payload=cached.get(chosen.key)??await fetchJSON(boardEndpoint(chosen.provider,chosen.slug));
        const official=findOfficialJob(payload,chosen.provider,chosen.id);
        if(!official)continue;
        const d=classifyOfficialPosting(postingDescription(official,chosen.provider),postingLocation(official,chosen.provider));
        const wrote=await db.rpc('ci_record_ats_review',{
          p_job_id:item.job_id,p_source_url:chosen.sourceURL,
          p_status:d.status,p_confidence:d.confidence,
          p_excerpt:d.excerpt,p_reason:d.reason
        });
        if(wrote.error||!wrote.data){report.failures++;}
        else{
          report.reviewed++;
          await recordStage('eligibility','official_eligibility_reviewer','assessment_saved',
            {provider:chosen.provider,board:chosen.slug,job_id:item.job_id,format:'official_posting'},
            {status:d.status,reason:d.reason,confidence:d.confidence,format:'eligibility_assessment'},item.job_id);
          if(d.status==='verified_eligible')report.verified_eligible++;
          else if(d.status==='likely_eligible')report.likely_eligible++;
          else if(d.status==='ineligible')report.ineligible++;
          else report.unknown++;
          const facts=classifyWorkFacts(d.excerpt);
          if(d.excerpt&&(facts.workMode!=='unknown'||facts.sponsorship!=='unknown')){
            const savedFacts=await db.rpc('ci_record_ats_work_facts',{
              p_job_id:item.job_id,p_source_url:chosen.sourceURL,p_excerpt:d.excerpt,
              p_work_mode:facts.workMode,p_sponsorship:facts.sponsorship
            });
            if(savedFacts.error||!savedFacts.data)report.failures++;
          }
        }
      }catch{report.failures++;}
    }
    }
    if(role==='legacy'||role==='matching'){
    // Only approved, matching-safe Obsidian knowledge can unlock matching tasks.
    // A missing vault leaves the workflow awaiting approval rather than inventing skills.
    const documents=rows(checked(await db.from('ci_knowledge_documents')
      .select('id,path,git_sha,content_sha,visibility')
      .eq('status','approved').in('visibility',['matching-safe','agents-safe'])
      .order('path').limit(50)));
    if(documents.length){
      const versionResult=await db.from('ci_knowledge_versions')
        .select('document_id,revision,body')
        .in('document_id',documents.map(d=>d.id))
        .in('revision',documents.map(d=>d.content_sha)).limit(150);
      if(versionResult.error)throw new Error('approved knowledge revision retrieval failed');
      const versions=rows(versionResult.data);
      const approved=documents.flatMap(d=>{
        const version=versions.find(v=>v.document_id===d.id&&v.revision===d.content_sha);
        return version&&typeof version.body==='string'&&version.body.trim()
          ?[{path:d.path,content_sha:d.content_sha,body:version.body.slice(0,8000)}]:[];
      });
      if(approved.length){
        checked(await db.rpc('ci_refresh_verified_handoffs',{p_limit:20}));
        const revision=await approvedRevision(approved);
        const tasks=rows(checked(await db.from('ci_workflow_tasks')
          .select('id,input_ref').eq('task_type','matching').eq('state','pending')
          .order('created_at').limit(30)));
        let matchedInThisRun=0;
        for(const task of tasks){
          if(matchedInThisRun>=3)break;
          const input=String(task.input_ref||'');
          const jobId=input.startsWith('job:')?input.slice(4):'';
          if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(jobId))continue;
          const job=checked(await db.from('ci_jobs').select('id,title,remote_text,status')
            .eq('id',jobId).maybeSingle());
          if(!job||job.status!=='open')continue;
          const result=scoreApprovedMatch(job.title,job.remote_text,approved.map(d=>d.body));
          if(!result)continue;
          const completed=await db.rpc('ci_record_verified_match',{
            p_job_id:job.id,p_revision:revision,p_score:result.score,
            p_matched:result.matched,p_gaps:result.gaps
          });
          if(completed.error)report.failures++;
          else if(completed.data){
            matchedInThisRun++;
            report.matched++;
            await recordStage('matching','approved_knowledge_matcher','match_recorded',
              {job_id:job.id,knowledge_revision:revision,format:'approved_knowledge'},
              {score:result.score,matched:result.matched.length,format:'job_match'},job.id);
          }
        }
      }
    }
    }
    if(role==='people')report.people_processed=await runPeople(db,runID!,recordStage);
    if(role==='outreach')report.drafts_prepared=await runOutreach(db,runID!,recordStage);
    if(role==='conversation')report.replies_classified=await runConversation(db,runID!,recordStage);
    await recordStage('sources','signed_ci_worker','run_finished',
      {format:'worker_summary'},
      {status:report.failures?'partial':'completed',
       processed:report.ats_jobs+report.remotive+report.himalayas,
       reviews:report.reviewed,failures:report.failures,role});
    checked(await db.from('ci_worker_runs').update({
      finished_at:new Date().toISOString(),
      state:report.failures?'partial':'completed',details:report
    }).eq('id',runID));
    return response(200,{status:report.failures?'partial':'completed',...report});
  }catch(error){
    console.error('ci-worker internal error',error instanceof Error?error.name:'unknown');
    if(runID)await db.from('ci_worker_runs').update({
      state:'failed',finished_at:new Date().toISOString(),details:report
    }).eq('id',runID);
    return response(503,{error:'Unattended research temporarily unavailable'});
  }
});
