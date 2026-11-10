// Career Intelligence server-only gateway. NEVER expose the service-role key.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import {route,isUuid,validApplication,validDraft,validReply,classifyReply,roleRestricted} from './policy.mjs';
import {boardEndpoint,normalizeBoard,validBoard} from './ats.mjs';
import {classifyOfficialPosting,findOfficialJob,postingDescription} from './eligibility.mjs';
import {classifyWorkFacts} from './work-facts.mjs';
import {candidateBoards} from './candidates.mjs';
import {currentEligibility,visibleMatchScore,currentApprovedRevision} from './decision.mjs';

const baseHeaders = {'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0','x-content-type-options':'nosniff'};
const reply=(status:number,payload:unknown)=>new Response(JSON.stringify(payload),{status,headers:baseHeaders});
const fail=(error:unknown)=>{ console.error('ci-api database request failed',error instanceof Error ? error.name : 'unknown'); return reply(503,{error:'Career Intelligence storage unavailable'}); };
function check<T>(r:{data:T;error:unknown}):T { if(r.error) throw new Error('database operation failed');return r.data; }
function list<T>(d:T[]|null|undefined):T[]{return d ?? [];}
function safeLimit(raw:string|null,max=100){const n=Number(raw??100);return Number.isSafeInteger(n) ? Math.max(1,Math.min(n,max)) : 100;}

Deno.serve(async (request:Request)=>{
  if(request.method==='OPTIONS')return reply(405,{error:'CORS is not enabled; use the authenticated same-origin dashboard proxy'});
  const operation=route(request.url,request.method);
  if(!operation)return reply(404,{error:'Not found'});
  const header=request.headers.get('Authorization')||'';
  if(!header.startsWith('Bearer ') || header.length>8250)return reply(401,{error:'Bearer token required'});
  const token=header.slice(7);
  if(!token || /\s/.test(token))return reply(401,{error:'Invalid bearer token'});
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply(503,{error:'Private backend not configured'});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user?.id)return reply(401,{error:'Invalid or expired Supabase token'});
  const owner=auth.user.id;
  // Explicit allowlist means other authenticated Groundwork users receive no Career Intelligence data.
  const allow=await db.from('ci_workspace_owners').select('owner_user_id').eq('owner_user_id',owner).maybeSingle();
  if(allow.error)return fail(allow.error);
  if(!allow.data)return reply(403,{error:'Career Intelligence owner access only'});
  if(request.method==='POST' && Number(request.headers.get('content-length')||0)>8192)
    return reply(413,{error:'Payload too large'});
  try{
    if(operation.type==='read'){
      const path=operation.path;

      if(path==='flow'){
        // Read-only, owner-gated observability. No secret, note body, or raw employer payload.
        const [
          events,jobSources,assessments,matches,tasks,workers,
          jobs,boards,knowledgeCount,matchCount,evidenceCount,
          queued,sourceCount,jobCount,contacts,drafts,conversations,batches
        ]=await Promise.all([
          db.from('ci_pipeline_events')
            .select('id,worker_run_id,job_id,stage,agent,event_type,input_preview,output_preview,occurred_at')
            .order('id',{ascending:false}).limit(100),
          db.from('ci_job_sources')
            .select('id,job_id,source_name,source_job_id,retrieved_at')
            .order('retrieved_at',{ascending:false}).limit(45),
          db.from('ci_eligibility_assessments')
            .select('id,job_id,status,confidence,reasons,assessed_at')
            .order('assessed_at',{ascending:false}).limit(45),
          db.from('ci_job_matches')
            .select('id,job_id,score,computed_at')
            .order('computed_at',{ascending:false}).limit(25),
          db.from('ci_workflow_tasks')
            .select('id,task_type,state,input_ref,updated_at')
            .order('updated_at',{ascending:false}).limit(100),
          db.from('ci_worker_runs')
            .select('id,started_at,finished_at,state,details')
            .order('started_at',{ascending:false}).limit(12),
          db.from('ci_jobs')
            .select('id,title,status,published_at,first_seen_at,ci_companies(legal_name)')
            .order('first_seen_at',{ascending:false}).limit(70),
          db.from('ci_discovery_sources').select('id',{head:true,count:'exact'})
            .eq('kind','ats').eq('state','active'),
          db.from('ci_knowledge_documents').select('id',{head:true,count:'exact'})
            .eq('status','approved').in('visibility',['matching-safe','agents-safe']),
          db.from('ci_job_matches').select('id',{head:true,count:'exact'}),
          db.from('ci_eligibility_evidence').select('id',{head:true,count:'exact'}),
          db.from('ci_eligibility_review_queue').select('job_id',{head:true,count:'exact'}).eq('state','pending'),
          db.from('ci_job_sources').select('id',{head:true,count:'exact'}),
          db.from('ci_jobs').select('id',{head:true,count:'exact'}),
          db.from('ci_contacts').select('id',{head:true,count:'exact'}),
          db.from('ci_outreach_drafts').select('id',{head:true,count:'exact'}).eq('owner_user_id',owner),
          db.from('ci_conversation_events').select('id',{head:true,count:'exact'}).eq('owner_user_id',owner),
          db.from('ci_daily_batches').select('id,local_date,state,target,generated_at')
            .eq('owner_user_id',owner).order('local_date',{ascending:false}).limit(1)
        ]);
        for(const result of [events,jobSources,assessments,matches,tasks,workers,jobs,
          boards,knowledgeCount,matchCount,evidenceCount,queued,sourceCount,jobCount,
          contacts,drafts,conversations,batches]){
          if(result.error)throw new Error('flow observability read unavailable');
        }
        const latest=list(batches.data)[0];
        let delivered=0;
        if(latest){
          const count=await db.from('ci_daily_batch_items').select('id',{head:true,count:'exact'}).eq('batch_id',latest.id);
          if(count.error)throw new Error('delivery observation unavailable');
          delivered=count.count??0;
        }
        const trueEvents=list(events.data).map((e:any)=>({
          id:'event:'+e.id,run_id:e.worker_run_id,job_id:e.job_id,
          stage:e.stage,agent:e.agent,type:e.event_type,
          input:e.input_preview,output:e.output_preview,
          time:e.occurred_at,kind:'instrumented'
        }));
        // Pre-instrumentation records remain visible, explicitly identified as
        // provenance snapshots rather than reconstructed live agent executions.
        const historical=[
          ...list(jobSources.data).map((s:any)=>({
            id:'source:'+s.id,job_id:s.job_id,stage:'ingestion',agent:'source_ingest',
            type:'source_recorded',input:{source:s.source_name,source_job_id:s.source_job_id},
            output:{job_id:s.job_id,format:'canonical_job'},time:s.retrieved_at,kind:'provenance'
          })),
          ...list(assessments.data).map((a:any)=>({
            id:'assessment:'+a.id,job_id:a.job_id,stage:'eligibility',
            agent:'official_eligibility_reviewer',type:'assessment_recorded',
            input:{job_id:a.job_id,format:'official_evidence'},
            output:{status:a.status,confidence:a.confidence},time:a.assessed_at,kind:'provenance'
          })),
          ...list(matches.data).map((m:any)=>({
            id:'match:'+m.id,job_id:m.job_id,stage:'matching',
            agent:'approved_knowledge_matcher',type:'match_recorded',
            input:{job_id:m.job_id,format:'approved_knowledge'},
            output:{score:m.score},time:m.computed_at,kind:'provenance'
          }))
        ];
        const timelines=[...trueEvents,...historical]
          .filter((e:any)=>e.time&&Number.isFinite(Date.parse(e.time)))
          .sort((a:any,b:any)=>Date.parse(b.time)-Date.parse(a.time))
          .slice(0,160);
        const stageCounts={
          sources:boards.count??0,registry:boards.count??0,ingestion:jobCount.count??0,
          eligibility:assessments.data?.length??0,matching:matchCount.count??0,
          ranking:null,delivery:delivered,people:contacts.count??0,
          outreach:drafts.count??0,conversation:conversations.count??0,
          knowledge:knowledgeCount.count??0
        };
        const roleNames=['discovery','eligibility','matching','people','outreach','conversation'];
        const roleStates=roleNames.map(role=>{
          const xs=list(tasks.data).filter((t:any)=>t.task_type===role);
          const active=xs.find((t:any)=>t.state==='running'||t.state==='leased');
          return {role,total_tasks:xs.length,active:!!active,
            latest_state:xs[0]?.state||'not_observed',
            latest_at:xs[0]?.updated_at||null};
        });
        return reply(200,{
          observed_at:new Date().toISOString(),poll_interval_ms:8000,
          stage_counts:stageCounts,source_records:sourceCount.count??0,
          evidence_records:evidenceCount.count??0,
          review_pending:queued.count??0,
          knowledge_documents:knowledgeCount.count??0,
          latest_batch:latest?{date:latest.local_date,state:latest.state,target:latest.target,delivered}:null,
          runs:list(workers.data),roles:roleStates,
          jobs:list(jobs.data).map((j:any)=>({
            id:j.id,title:j.title,company:j.ci_companies?.legal_name||'Unknown',
            status:j.status,published_at:j.published_at,first_seen_at:j.first_seen_at
          })),
          events:timelines,
          note:'Only newly instrumented events represent direct worker stage execution. Historical provenance is labeled separately. Six LangGraph roles may be idle.'
        });
      }
      if(path==='source-candidates'){
        const suggestions=list(check(await db.from('ci_ats_source_candidates')
          .select('id,provider,board_slug,company_name,evidence_url,source_kind,state,discovered_at')
          .eq('state','pending').order('discovered_at',{ascending:false}).limit(100)));
        return reply(200,{candidates:suggestions});
      }
      if(path==='sources'){
        const sources=list(check(await db.from('ci_discovery_sources')
          .select('id,name,kind,state,config,first_discovered_at')
          .eq('kind','ats').order('first_discovered_at',{ascending:false}).limit(50)));
        return reply(200,{sources});
      }
      if(path==='eligibility-queue'){
        const rows=list(check(await db.from('ci_eligibility_review_queue')
          .select('job_id,state,first_queued_at,last_seen_at,ci_jobs(id,title,apply_url,company_id,ci_companies(legal_name))')
          .eq('state','pending').order('first_queued_at').limit(100)));
        return reply(200,{items:rows.map((x:any)=>({
          job_id:x.job_id,state:x.state,first_queued_at:x.first_queued_at,
          title:x.ci_jobs?.title||'Unspecified',
          company_name:x.ci_jobs?.ci_companies?.legal_name||'Unknown company',
          apply_url:x.ci_jobs?.apply_url||null
        }))});
      }
      if(path==='preferences'){
        const prefs=check(await db.from('ci_discovery_preferences')
          .select('daily_target,job_families,seniority_levels,work_modes,sponsorship,updated_at')
          .eq('owner_user_id',owner).maybeSingle());
        return reply(200,{preferences:prefs||{
          daily_target:25,job_families:['any'],seniority_levels:['any'],
          work_modes:['any'],sponsorship:'any',updated_at:null
        },note:'Unknown work mode or visa support is never counted as a verified match.'});
      }
      if(path==='metrics'){
        const [companies,jobs,delivered,applications]=await Promise.all([
          db.from('ci_companies').select('id',{head:true,count:'exact'}),
          db.from('ci_jobs').select('id',{head:true,count:'exact'}),
          db.from('ci_delivered_companies').select('company_id',{head:true,count:'exact'}).eq('owner_user_id',owner),
          db.from('ci_applications').select('id',{head:true,count:'exact'}).eq('owner_user_id',owner),
        ]);
        for(const r of [companies,jobs,delivered,applications])if(r.error)throw new Error('count failed');
        return reply(200,{companies:companies.count??0,jobs:jobs.count??0,delivered:delivered.count??0,applications:applications.count??0});
      }
      if(path==='jobs'){
        const limit=safeLimit(new URL(request.url).searchParams.get('limit'),500);
        const jobs=list(check(await db.from('ci_jobs').select('id,title,apply_url,status,published_at,first_seen_at,company_id,ci_companies(legal_name)').order('published_at',{ascending:false,nullsFirst:false}).limit(limit)));
        const ids=jobs.map((x:any)=>x.id);
        if(!ids.length)return reply(200,{jobs:[]});
        const [e,m,sources,evidence,tasks,documents]=await Promise.all([
          db.from('ci_eligibility_assessments').select('id,job_id,status,assessed_at,expires_at')
            .in('job_id',ids).order('assessed_at',{ascending:false}).order('id',{ascending:false}).limit(1000),
          db.from('ci_job_matches').select('job_id,score,computed_at,knowledge_revision')
            .in('job_id',ids).order('computed_at',{ascending:false}).limit(1000),
          db.from('ci_job_sources').select('job_id,source_name,source_url')
            .in('job_id',ids).order('retrieved_at',{ascending:false}).limit(1000),
          db.from('ci_eligibility_evidence').select('job_id')
            .in('job_id',ids).limit(1000),
          db.from('ci_workflow_tasks').select('input_ref,state')
            .eq('task_type','matching')
            .in('input_ref',ids.map((id:string)=>'job:'+id)).limit(1000),
          db.from('ci_knowledge_documents').select('id,path,git_sha,content_sha')
            .eq('status','approved').in('visibility',['matching-safe','agents-safe']).limit(50)
        ]);
        const es=new Map<string,any>(),ms=new Map<string,any>(),
          ss=new Map<string,{name:string,url:string}>(),taskStates=new Map<string,string>();
        const evidenceJobs=new Set(list(check(evidence)).map((v:any)=>v.job_id));
        for(const item of list(check(e)))if(!es.has(item.job_id))es.set(item.job_id,item);
        for(const item of list(check(m)))if(!ms.has(item.job_id))ms.set(item.job_id,item);
        for(const item of list(check(sources)))if(!ss.has(item.job_id))
          ss.set(item.job_id,{name:item.source_name,url:item.source_url});
        for(const item of list(check(tasks)))taskStates.set(item.input_ref,item.state);
        const approvedDocs=list(check(documents));
        let activeKnowledgeRevision:string|null=null;
        if(approvedDocs.length){
          const revisions=list(check(await db.from('ci_knowledge_versions')
            .select('document_id,revision,body')
            .in('document_id',approvedDocs.map((d:any)=>d.id))
            .in('revision',approvedDocs.map((d:any)=>d.git_sha))
            .limit(150)));
          const validDocs=approvedDocs.filter((d:any)=>revisions.some((v:any)=>
            v.document_id===d.id && v.revision===d.git_sha &&
            typeof v.body==='string' && v.body.trim().length>0));
          activeKnowledgeRevision=await currentApprovedRevision(validDocs);
        }
        const stamp=Date.now();
        return reply(200,{jobs:jobs.map((j:any)=>{
          const decision=currentEligibility(es.get(j.id),evidenceJobs.has(j.id),stamp);
          return {
            id:j.id,title:j.title,apply_url:j.apply_url,status:j.status,
            published_at:j.published_at,first_seen_at:j.first_seen_at,
            company_id:j.company_id,company_name:j.ci_companies?.legal_name||'',
            eligibility:decision.status,eligibility_expired:decision.expired,
            eligibility_reason:decision.reason,
            match_score:visibleMatchScore(ms.get(j.id),decision,taskStates.get('job:'+j.id),activeKnowledgeRevision),
            source:ss.get(j.id)?.name||'unknown',
            source_url:ss.get(j.id)?.url||null
          };
        })});
      }
      if(path==='people'){
        const xs=list(check(await db.from('ci_contacts').select('id,name,current_title,profile_url,company_id,identity_verified,ci_companies(legal_name)').order('created_at',{ascending:false}).limit(100)));
        return reply(200,{contacts:xs.map((j:any)=>({...j,company_name:j.ci_companies?.legal_name||'',ci_companies:undefined}))});
      }
      if(path==='knowledge'){
        const [documents,syncs]=await Promise.all([
          db.from('ci_knowledge_documents')
            .select('path,visibility,git_sha,content_sha,updated_at')
            .eq('status','approved').order('path').limit(500),
          db.from('ci_knowledge_sync_runs')
            .select('git_sha,status,approved_count,changed_count,tombstoned_count,skipped_count,finished_at')
            .order('finished_at',{ascending:false}).limit(1)
        ]);
        return reply(200,{documents:list(check(documents)),last_sync:list(check(syncs))[0]||null,
          note:'Only explicitly approved non-private notes are indexed. Actual note bodies remain server-only.'});
      }
      if(path==='applications'){
        const xs=list(check(await db.from('ci_applications').select('id,job_id,status,applied_at,notes,ci_jobs(title,apply_url),ci_companies(legal_name)').eq('owner_user_id',owner).order('applied_at',{ascending:false,nullsFirst:false}).limit(500)));
        return reply(200,{applications:xs.map((x:any)=>({id:x.id,job_id:x.job_id,status:x.status,applied_at:x.applied_at,notes:x.notes,title:x.ci_jobs?.title||'',apply_url:x.ci_jobs?.apply_url||'',company_name:x.ci_companies?.legal_name||''}))});
      }
      if(path==='outreach'){
        const drafts=list(check(await db.from('ci_outreach_drafts')
          .select('id,job_id,contact_id,subject,body,status,created_at')
          .eq('owner_user_id',owner).order('created_at',{ascending:false}).limit(100)));
        if(!drafts.length)return reply(200,{drafts:[],intents:[],approvals:[]});
        const ids=drafts.map((d:any)=>d.id);
        const [outbound,active]=await Promise.all([
          db.from('ci_outbound_messages').select('id,draft_id,status,created_at,sent_at,last_attempt_at,error_code')
            .in('draft_id',ids).order('created_at',{ascending:false}).limit(100),
          db.from('ci_outreach_approvals').select('draft_id,mode,approved_at')
            .eq('owner_user_id',owner).is('revoked_at',null).in('draft_id',ids).limit(100),
        ]);
        return reply(200,{drafts,intents:list(check(outbound)),approvals:list(check(active))});
      }
      if(path==='conversations'){
        const xs=list(check(await db.from('ci_conversation_events').select('id,event_type,occurred_at,evidence,ci_jobs(title,ci_companies(legal_name)),ci_contacts(name)').eq('owner_user_id',owner).order('occurred_at',{ascending:false}).limit(100)));
        return reply(200,{events:xs.map((x:any)=>({id:x.id,event_type:x.event_type,occurred_at:x.occurred_at,evidence:x.evidence,title:x.ci_jobs?.title||'',company_name:x.ci_jobs?.ci_companies?.legal_name||'',contact_name:x.ci_contacts?.name||''}))});
      }
      if(path==='operations'){
        const states=list(check(await db.from('ci_workflow_tasks').select('state').limit(1000)));
        const counts:Record<string,number>={};for(const row of states)counts[row.state]=(counts[row.state]??0)+1;
        const batches=list(check(await db.from('ci_daily_batches')
          .select('id,local_date,state,generated_at,target')
          .eq('owner_user_id',owner).order('local_date',{ascending:false}).limit(1)));
        let delivery=null;
        if(batches.length){
          const batch=batches[0];
          const items=await db.from('ci_daily_batch_items')
            .select('id',{head:true,count:'exact'}).eq('batch_id',batch.id);
          if(items.error)throw new Error('batch item count failed');
          delivery={date:batch.local_date,state:batch.state,
            delivered:items.count??0,target:batch.target};
        }
        const workerRuns=list(check(await db.from('ci_worker_runs')
          .select('started_at,finished_at,state,details')
          .order('started_at',{ascending:false}).limit(10)));
        // Read-only funnel: distinguish discovery from evidence-backed, eligible delivery.
        // Counts are independent observations, not a claim that all jobs have passed each stage.
        const since=new Date(Date.now()-7*86400_000).toISOString();
        const [
          jobsTotal,sourceRecords,openJobs,recentPublication,
          eligibilityRecords,officialEvidence,boards,candidates
        ]=await Promise.all([
          db.from('ci_jobs').select('id',{head:true,count:'exact'}),
          db.from('ci_job_sources').select('id',{head:true,count:'exact'}),
          db.from('ci_jobs').select('id',{head:true,count:'exact'}).eq('status','open'),
          db.from('ci_jobs').select('id',{head:true,count:'exact'}).gte('published_at',since),
          db.from('ci_eligibility_assessments').select('id',{head:true,count:'exact'}),
          db.from('ci_eligibility_evidence').select('id',{head:true,count:'exact'}),
          db.from('ci_discovery_sources').select('id',{head:true,count:'exact'}).eq('kind','ats').eq('state','active'),
          db.from('ci_ats_source_candidates').select('id',{head:true,count:'exact'}).eq('state','pending'),
        ]);
        for(const query of [jobsTotal,sourceRecords,openJobs,recentPublication,eligibilityRecords,officialEvidence,boards,candidates]){
          if(query.error)throw new Error('readiness count unavailable');
        }
        const readiness={
          discovered_jobs:jobsTotal.count??0,
          source_records:sourceRecords.count??0,
          open_jobs:openJobs.count??0,
          recent_confirmed_publication:recentPublication.count??0,
          eligibility_assessments:eligibilityRecords.count??0,
          eligibility_evidence:officialEvidence.count??0,
          active_ats_boards:boards.count??0,
          pending_source_candidates:candidates.count??0,
        };
        const integrity=check(await db.rpc('ci_pipeline_integrity_report',{p_owner:owner}));
        return reply(200,{states:counts,delivery,workerRuns,readiness,integrity});
      }
    }

    if(operation.type==='flowJob'){
      const job=check(await db.from('ci_jobs')
        .select('id,title,apply_url,status,published_at,remote_text,first_seen_at,description_hash,ci_companies(legal_name)')
        .eq('id',operation.jobId).maybeSingle());
      if(!job)return reply(404,{error:'Job not found'});
      const [sources,assessments,evidence,matches,delivered,events,tasks]=await Promise.all([
        db.from('ci_job_sources')
          .select('source_name,source_job_id,source_url,retrieved_at,raw_hash')
          .eq('job_id',job.id).order('retrieved_at',{ascending:false}).limit(8),
        db.from('ci_eligibility_assessments')
          .select('status,confidence,reasons,contradictions,assessed_at,expires_at')
          .eq('job_id',job.id).order('assessed_at',{ascending:false}).limit(5),
        db.from('ci_eligibility_evidence')
          .select('source_url,source_kind,excerpt,observed_at,scope,claim')
          .eq('job_id',job.id).order('observed_at',{ascending:false}).limit(5),
        db.from('ci_job_matches')
          .select('score,matched,gaps,computed_at,knowledge_revision')
          .eq('job_id',job.id).order('computed_at',{ascending:false}).limit(3),
        db.from('ci_delivered_jobs').select('job_id')
          .eq('job_id',job.id).eq('owner_user_id',owner).limit(1),
        db.from('ci_pipeline_events')
          .select('id,stage,agent,event_type,input_preview,output_preview,occurred_at')
          .eq('job_id',job.id).order('id',{ascending:false}).limit(50),
        db.from('ci_workflow_tasks')
          .select('id,task_type,state,created_at,updated_at')
          .eq('input_ref','job:'+job.id).order('created_at',{ascending:false}).limit(30)
      ]);
      for(const q of [sources,assessments,evidence,matches,delivered,events,tasks]){
        if(q.error)throw new Error('lineage data unavailable');
      }
      const latestSource=list(sources.data)[0],assessment=list(assessments.data)[0],
        proof=list(evidence.data)[0],match=list(matches.data)[0];
      const snapshots:any[]=[];
      if(latestSource){
        snapshots.push({stage:'sources',time:latestSource.retrieved_at,
          before:{provider:latestSource.source_name,external_id:latestSource.source_job_id,
            listing_url:latestSource.source_url,raw_payload:'Not retained; source hash available'},
          after:{source_name:latestSource.source_name,job_id:job.id,
            source_hash:latestSource.raw_hash||'Not recorded'}});
      }
      snapshots.push({stage:'ingestion',time:job.first_seen_at,
        before:latestSource?{provider:latestSource.source_name,
          provider_job_id:latestSource.source_job_id}:{source:'Not recorded'},
        after:{id:job.id,company:job.ci_companies?.legal_name||'Unknown',
          title:job.title,status:job.status,published_at:job.published_at,
          location:job.remote_text,description_hash:job.description_hash}});
      if(assessment){
        snapshots.push({stage:'eligibility',time:assessment.assessed_at,
          before:{official_url:proof?.source_url||null,
            excerpt:typeof proof?.excerpt==='string'?proof.excerpt.slice(0,700):null,
            evidence_scope:proof?.scope||null},
          after:{status:assessment.status,confidence:assessment.confidence,
            reasons:assessment.reasons,expires_at:assessment.expires_at}});
      }
      if(match){
        snapshots.push({stage:'matching',time:match.computed_at,
          before:{job_id:job.id,knowledge_revision:match.knowledge_revision},
          after:{score:match.score,matched:match.matched,gaps:match.gaps}});
      }
      if(list(delivered.data).length){
        snapshots.push({stage:'delivery',time:null,before:{job_id:job.id},
          after:{delivered:true,lifetime_deduplicated:true}});
      }
      return reply(200,{
        job:{id:job.id,title:job.title,company:job.ci_companies?.legal_name||'Unknown',
          status:job.status,apply_url:job.apply_url},
        snapshots,events:list(events.data).map((e:any)=>({
          id:e.id,stage:e.stage,agent:e.agent,type:e.event_type,
          input:e.input_preview,output:e.output_preview,time:e.occurred_at
        })),tasks:list(tasks.data),
        note:'Source payloads are not retained. This view shows persisted, timestamped before/after records; missing stages are not simulated.'
      });
    }
    if(operation.type==='batch'){
      const bs=list(check(await db.from('ci_daily_batches').select('id').eq('owner_user_id',owner).eq('local_date',operation.day).limit(1)));
      if(!bs.length)return reply(200,{items:[]});
      const xs=list(check(await db.from('ci_daily_batch_items').select('job_id,company_id,rank,ci_jobs(title,apply_url,published_at),ci_companies(legal_name)').eq('batch_id',bs[0].id).order('rank').limit(100)));
      return reply(200,{items:xs.map((x:any)=>({job_id:x.job_id,company_id:x.company_id,rank:x.rank,title:x.ci_jobs?.title||'',apply_url:x.ci_jobs?.apply_url||'',published_at:x.ci_jobs?.published_at||null,company_name:x.ci_companies?.legal_name||''}))});
    }
    if(operation.type==='evidence'){
      const job=check(await db.from('ci_jobs').select('id,title,apply_url,status,company_id').eq('id',operation.jobId).maybeSingle());
      if(!job)return reply(404,{error:'Job not found'});
      const [assessments,evidence,sources]=await Promise.all([
        db.from('ci_eligibility_assessments').select('id,status,confidence,reasons,contradictions,policy_version,assessed_at,expires_at').eq('job_id',job.id).order('assessed_at',{ascending:false}).limit(20),
        db.from('ci_eligibility_evidence').select('id,source_url,source_kind,excerpt,observed_at,scope,claim,confidence').eq('job_id',job.id).order('observed_at',{ascending:false}).limit(30),
        db.from('ci_job_sources').select('source_name,source_url,retrieved_at').eq('job_id',job.id).order('retrieved_at',{ascending:false}).limit(20),
      ]);
      return reply(200,{job,assessments:list(check(assessments)),evidence:list(check(evidence)),sources:list(check(sources)),
        note:'Eligibility is only verified when current, authoritative employer evidence supports the specific role. A remote label is not proof of Nigeria eligibility.'});
    }
    if(operation.type==='savePreferences'){
      const families=['any','backend','frontend','fullstack','platform','ai_ml','security','data'];
      const levels=['any','intern','junior','mid','senior','staff'];
      const modes=['any','remote','hybrid','onsite'];
      const validArray=(items:unknown,allowed:string[],max:number)=>
        Array.isArray(items)&&items.length>0&&items.length<=max&&
        items.every((x:any)=>typeof x==='string'&&allowed.includes(x))&&
        new Set(items).size===items.length&&
        (!items.includes('any')||items.length===1);
      if(!body||!Number.isInteger(body.daily_target)||body.daily_target<1||body.daily_target>100||
        !validArray(body.job_families,families,7)||
        !validArray(body.seniority_levels,levels,5)||
        !validArray(body.work_modes,modes,4)||
        !['any','confirmed_required'].includes(body.sponsorship))
        return reply(422,{error:'Invalid discovery preferences'});
      const saved=check(await db.rpc('ci_save_discovery_preferences',{
        p_owner:owner,p_target:body.daily_target,p_families:body.job_families,
        p_levels:body.seniority_levels,p_modes:body.work_modes,
        p_sponsorship:body.sponsorship
      }));
      if(!saved)return reply(409,{error:'Preferences could not be saved'});
      return reply(200,{saved:true,note:'Future recommendation batches use these limits. Previously delivered items are never silently changed.'});
    }
    if(operation.type==='generateBatch'){
      const localDate = new Intl.DateTimeFormat('sv-SE',{
        timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'
      }).format(new Date());
      const preferences=check(await db.from('ci_discovery_preferences')
        .select('daily_target').eq('owner_user_id',owner).maybeSingle());
      const generated=check(await db.rpc('ci_generate_daily_batch',{
        p_owner_user_id:owner,p_local_date:localDate,p_target:preferences?.daily_target??25
      }));
      return reply(200,{day:localDate,inserted:generated,target:preferences?.daily_target??25,
        note:'Only previously unseen employers with evidence-backed verified eligible open roles are delivered.'});
    }
    if(operation.type==='discover'){
      // Remotive's public API asks clients to limit requests to four/day and attribute source.
      // This is an owner-initiated, bounded ingestion. Listings remain unverified.
      const gate=check(await db.rpc('ci_claim_feed_slot',{p_action:'remotive'}));
      if(!gate)return reply(429,{error:'The public job source can only be checked once every six hours'});
      let data:any;
      try{
        const ctl=AbortSignal.timeout(15000);
        const response=await fetch('https://remotive.com/api/remote-jobs?category=software-dev&limit=100',
          {headers:{'user-agent':'CareerIntelligencePersonalResearch/0.5'},redirect:'error',signal:ctl});
        if(!response.ok)return reply(502,{error:'Job source temporarily unavailable'});
        data=await response.json();
      }catch{return reply(502,{error:'Job source temporarily unavailable'});}
      if(!Array.isArray(data?.jobs))return reply(502,{error:'Unexpected job source format'});
      let imported=0,skipped=0,candidates=0;
      const now=Date.now();
      for(const job of data.jobs.slice(0,100)){
        const title=String(job?.title||'').trim();
        const company=String(job?.company_name||'').trim();
        const raw=String(job?.publication_date||'');
        const hasOffset=/(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
        const date=new Date(hasOffset?raw:raw+'Z');
        const sourceId=String(job?.id||'');
        let src:URL;
        try{src=new URL(String(job?.url||''));}catch{skipped++;continue;}
        if(src.protocol!=='https:'||src.hostname!=='remotive.com'||
          !src.pathname.startsWith('/remote-jobs/')||!Number.isFinite(date.getTime())||
          date.getTime()<now-7*86400000||date.getTime()>now+86400000||
          !/engineer|developer|platform|devops|infrastructure|machine learning|research/i.test(title)){
          skipped++;continue;
        }
        const ingested=await db.rpc('ci_ingest_remotive_job',{
          p_source_id:sourceId,p_company:company,p_title:title,
          p_url:src.origin+src.pathname,p_published_at:date.toISOString(),
          p_location:String(job?.candidate_required_location||'').slice(0,500),
        });
        if(ingested.error||!ingested.data){skipped++;continue;}
        imported++;
        if(candidates<10){
          for(const possible of candidateBoards(job?.description,company,src.origin+src.pathname)){
            if(candidates>=10)break;
            const proposed=await db.rpc('ci_suggest_ats_board',{
              p_provider:possible.provider,p_board_slug:possible.slug,
              p_company_name:possible.company,p_evidence_url:possible.evidenceURL
            });
            if(!proposed.error&&proposed.data)candidates++;
          }
        }
      }
      return reply(200,{source:'Remotive',imported,skipped,candidates,checked:Math.min(data.jobs.length,100),
        note:'These are public listings only. Hiring eligibility has not been verified.'});
    }
    let body:any;
    try{body=await request.json();}catch{return reply(400,{error:'Invalid JSON body'});}
    if(operation.type==='decideCandidate'){
      if(!body||!isUuid(body.candidate_id)||!['approved','rejected'].includes(body.decision))
        return reply(422,{error:'Candidate UUID and valid decision required'});
      const reviewed=check(await db.rpc('ci_decide_ats_candidate',{
        p_candidate_id:body.candidate_id,p_decision:body.decision
      }));
      if(!reviewed)return reply(409,{error:'Candidate cannot be reviewed, was already handled, or source limit reached'});
      return reply(200,{decision:body.decision,
        note:'Only approved ATS candidates become scannable sources; hiring eligibility remains unverified.'});
    }
    if(operation.type==='registerSource'){
      if(!validBoard(body))return reply(422,{error:'Valid ATS provider, board slug and company name required'});
      const company=body.company.trim();
      const key='ats:'+body.provider+':'+body.slug;
      const existing=check(await db.from('ci_discovery_sources').select('id,config')
        .eq('name',key).maybeSingle());
      if(existing){
        if(existing.config?.company_name!==company)
          return reply(409,{error:'ATS source already registered with a different company'});
        return reply(200,{source_id:existing.id,registered:false});
      }
      const count=await db.from('ci_discovery_sources')
        .select('id',{head:true,count:'exact'}).eq('kind','ats');
      if(count.error)throw new Error('source count failed');
      if((count.count??0)>=50)return reply(429,{error:'Maximum 50 ATS boards reached'});
      const inserted=await db.from('ci_discovery_sources').insert({
        name:key,kind:'ats',state:'active',discovery_method:'manual',
        config:{provider:body.provider,slug:body.slug,company_name:company}
      }).select('id').single();
      if(inserted.error)return reply(409,{error:'Source already exists or unavailable'});
      return reply(200,{source_id:inserted.data.id,registered:true});
    }
    if(operation.type==='scanSource'){
      if(!body||!body.source_id||!isUuid(body.source_id))
        return reply(422,{error:'Valid source UUID required'});
      const source=check(await db.from('ci_discovery_sources')
        .select('id,kind,state,config').eq('id',body.source_id).maybeSingle());
      if(!source||source.kind!=='ats'||source.state!=='active'||!validBoard({
        provider:source.config?.provider,slug:source.config?.slug,company:source.config?.company_name
      }))return reply(404,{error:'Registered active ATS board not found'});
      const gate=check(await db.rpc('ci_claim_ats_slot',{p_source_id:source.id}));
      if(!gate)return reply(429,{error:'This ATS board can be scanned once every six hours'});
      let payload:unknown;
      try{
        const endpoint=boardEndpoint(source.config.provider,source.config.slug);
        const response=await fetch(endpoint,{
          headers:{'accept':'application/json','user-agent':'CareerIntelligenceResearch/0.6'},
          redirect:'error',signal:AbortSignal.timeout(12000)
        });
        if(!response.ok)return reply(502,{error:'ATS source unavailable or rate-limited'});
        if(Number(response.headers.get('content-length')||0)>2_000_000)
          return reply(502,{error:'ATS source response too large'});
        const raw=await response.text();
        if(raw.length>2_000_000)return reply(502,{error:'ATS source response too large'});
        payload=JSON.parse(raw);
      }catch{return reply(502,{error:'ATS source temporarily unavailable'});}
      let jobs;
      try{jobs=normalizeBoard(payload,source.config.provider,source.config.slug,source.config.company_name)}
      catch{return reply(502,{error:'Unexpected ATS listing format'});}
      let processed=0,rejected=0;
      for(const job of jobs.slice(0,30)){
        const result=await db.rpc('ci_ingest_ats_job',{
          p_provider:job.provider,p_board:job.board,p_source_job_id:job.sourceJobId,
          p_company:job.company,p_title:job.title,p_url:job.url,
          p_published_at:job.publishedAt,p_remote_text:job.remoteText
        });
        if(result.error||!result.data)rejected++;else processed++;
      }
      return reply(200,{source:source.config.provider,board:source.config.slug,
        processed,rejected,available:jobs.length,
        note:'Official public ATS listings were recorded and queued for eligibility review. None was automatically deemed eligible for Nigeria.'});
    }
    if(operation.type==='reviewEligibility'){
      if(!body||!isUuid(body.job_id))return reply(422,{error:'Valid job UUID required'});
      const q=check(await db.from('ci_eligibility_review_queue')
        .select('job_id,state').eq('job_id',body.job_id).maybeSingle());
      if(!q||q.state!=='pending')return reply(404,{error:'Job is not pending official ATS review'});
      const sources=list(check(await db.from('ci_job_sources')
        .select('source_name,source_job_id,source_url').eq('job_id',body.job_id)
        .in('source_name',['greenhouse','lever','ashby']).order('retrieved_at',{ascending:false}).limit(5)));
      let match:{provider:string,slug:string,sourceId:string,sourceURL:string}|null=null;
      for(const source of sources){
        const provider=source.source_name;
        if(!source.source_job_id || !['greenhouse','lever','ashby'].includes(provider))continue;
        const boardList=list(check(await db.from('ci_discovery_sources')
          .select('config').eq('kind','ats').eq('state','active')
          .eq('name','ats:'+provider+':'+source.source_job_id.split(':')[0]).limit(1)));
        const config=boardList[0]?.config;
        if(!config||!validBoard({provider:config.provider,slug:config.slug,company:config.company_name}))continue;
        const sourceId=source.source_job_id.slice(config.slug.length+1);
        if(source.source_job_id!==config.slug+':'+sourceId || !/^[A-Za-z0-9_-]{1,150}$/.test(sourceId))continue;
        match={provider,slug:config.slug,sourceId,sourceURL:source.source_url};
        break;
      }
      if(!match)return reply(422,{error:'No matching registered public ATS source for this job'});
      const gate=check(await db.rpc('ci_claim_job_review_slot',{p_job_id:body.job_id}));
      if(!gate)return reply(429,{error:'This job can be researched once every six hours'});
      let payload:any;
      try{
        const response=await fetch(boardEndpoint(match.provider,match.slug),{
          headers:{'accept':'application/json','user-agent':'CareerIntelligenceResearch/0.6'},
          redirect:'error',signal:AbortSignal.timeout(12000)
        });
        if(!response.ok)return reply(502,{error:'Official ATS source unavailable'});
        if(Number(response.headers.get('content-length')||0)>2_000_000)
          return reply(502,{error:'ATS response too large'});
        const raw=await response.text();
        if(raw.length>2_000_000)return reply(502,{error:'ATS response too large'});
        payload=JSON.parse(raw);
      }catch{return reply(502,{error:'Official ATS source temporarily unavailable'});}
      const official=findOfficialJob(payload,match.provider,match.sourceId);
      if(!official)return reply(404,{error:'Posting not found in current official ATS feed'});
      const decision=classifyOfficialPosting(postingDescription(official,match.provider));
      const recorded=check(await db.rpc('ci_record_ats_review',{
        p_job_id:body.job_id,p_source_url:match.sourceURL,
        p_status:decision.status,p_confidence:decision.confidence,
        p_excerpt:decision.excerpt,p_reason:decision.reason
      }));
      if(!recorded)return reply(409,{error:'Current verified assessment already exists or evidence was invalid'});
      // The second write is limited to the exact official evidence excerpt just stored.
      const facts=classifyWorkFacts(decision.excerpt);
      if(decision.excerpt && (facts.workMode!=='unknown'||facts.sponsorship!=='unknown')){
        const savedFacts=await db.rpc('ci_record_ats_work_facts',{
          p_job_id:body.job_id,p_source_url:match.sourceURL,p_excerpt:decision.excerpt,
          p_work_mode:facts.workMode,p_sponsorship:facts.sponsorship
        });
        if(savedFacts.error||!savedFacts.data)
          return reply(503,{error:'Official review saved but work arrangement could not be recorded; retry only after reviewing evidence state'});
      }
      return reply(200,{job_id:body.job_id,status:decision.status,confidence:decision.confidence,
        reason:decision.reason,
        note:'Only explicit official role-level evidence can verify Nigerian hiring eligibility. Worldwide remote wording is not sufficient.'});
    }
    if(operation.type==='application'){
      if(!validApplication(body))return reply(422,{detail:'Invalid application input'});
      const j=check(await db.from('ci_jobs').select('company_id').eq('id',body.job_id).maybeSingle());
      if(!j)return reply(404,{detail:'Job not found'});
      const record=check(await db.from('ci_applications').upsert({owner_user_id:owner,company_id:j.company_id,job_id:body.job_id,status:body.status,notes:body.notes||'',applied_at:body.status==='applied'?new Date().toISOString():null},{onConflict:'owner_user_id,job_id'}).select('id').single());
      return reply(200,{id:record.id});
    }
    if(operation.type==='approveOutreach'){
      if(!body || !isUuid(body.draft_id) || !['manual','standing'].includes(body.mode))
        return reply(422,{error:'Valid draft UUID and approval mode required'});
      const accepted=check(await db.rpc('ci_approve_outreach_draft',{
        p_owner:owner,p_draft:body.draft_id,p_mode:body.mode
      }));
      if(!accepted)return reply(409,{error:'Approval blocked: verify application, recipient, eligibility, suppression and policy'});
      return reply(200,{approved:true,draft_id:body.draft_id,mode:body.mode,
        note:'Approval recorded. No email has been sent.'});
    }
    if(operation.type==='revokeOutreach'){
      if(!body || !isUuid(body.draft_id))
        return reply(422,{error:'Valid draft UUID required'});
      const status=check(await db.rpc('ci_revoke_outreach_approval',{
        p_owner:owner,p_draft:body.draft_id
      }));
      if(status==='not_found')return reply(404,{error:'Outreach draft not found'});
      return reply(200,{draft_id:body.draft_id,status,
        note:status==='reconciliation_required'
          ?'A prior provider attempt has uncertain status and requires manual reconciliation. No retry will be attempted.'
          :status==='already_sent'
          ?'Approval revoked, but an already-sent email cannot be recalled.'
          :'Approval revoked and unsent pending intents cancelled.'});
    }
    if(operation.type==='prepareOutreachIntent'){
      if(!body || !isUuid(body.draft_id))
        return reply(422,{error:'Valid draft UUID required'});
      const intentId=check(await db.rpc('ci_prepare_outreach_intent',{
        p_owner:owner,p_draft:body.draft_id
      }));
      if(!intentId)return reply(409,{error:'Not eligible for queuing: approval, application, recipient, suppression or quota restriction'});
      return reply(200,{id:intentId,status:'pending',provider:'gmail',
        note:'A durable pending intent has been recorded. Sending is disabled until the Gmail dispatcher is connected and authorized.'});
    }
    if(operation.type==='draft'){
      if(!validDraft(body))return reply(422,{detail:'Invalid draft input'});
      const [jr,cr,ar,kr]=await Promise.all([
        db.from('ci_jobs').select('id,title,company_id').eq('id',body.job_id).maybeSingle(),
        db.from('ci_contacts').select('id,name,current_title,company_id,identity_verified').eq('id',body.contact_id).maybeSingle(),
        db.from('ci_eligibility_assessments').select('status').eq('job_id',body.job_id).order('assessed_at',{ascending:false}).limit(1),
        db.from('ci_knowledge_documents').select('path,git_sha').eq('status','approved').eq('visibility','outreach-safe').limit(1),
      ]);
      const job=check(jr),contact=check(cr),assessment=list(check(ar))[0],knowledge=list(check(kr))[0];
      if(!job||!contact||job.company_id!==contact.company_id||!contact.identity_verified||assessment?.status!=='verified_eligible'||!knowledge)
        return reply(422,{detail:'Verified eligible role, matching verified contact and approved outreach knowledge required'});
      // Evidence-limited template intentionally avoids inventing professional overlaps.
      const text=`Hello ${contact.name.split(' ')[0]},\n\nI recently came across the ${job.title} opportunity and would appreciate learning more about the engineering team and hiring process.\n\nThank you for your time.`;
      const res=check(await db.from('ci_outreach_drafts').insert({owner_user_id:owner,job_id:job.id,contact_id:contact.id,subject:`Question about ${job.title}`,body:text,knowledge_revision:knowledge.git_sha,personalization_evidence:[],status:'draft'}).select('id').single());
      return reply(200,{id:res.id});
    }
    if(operation.type==='conversation'){
      if(!validReply(body))return reply(422,{detail:'Invalid recruiter reply input'});
      const [jr,cr]=await Promise.all([
        db.from('ci_jobs').select('company_id').eq('id',body.job_id).maybeSingle(),
        db.from('ci_contacts').select('company_id').eq('id',body.contact_id).maybeSingle(),
      ]);
      const j=check(jr),c=check(cr);if(!j||!c||j.company_id!==c.company_id)return reply(422,{detail:'Contact and role must belong to the same company'});
      const eventType=classifyReply(body.body);
      const record=check(await db.from('ci_conversation_events').insert({owner_user_id:owner,job_id:body.job_id,contact_id:body.contact_id,event_type:eventType,evidence:{body:body.body,source_url:body.source_url,verification:'self_reported'}}).select('id').single());
      if(roleRestricted(body.body)){
        const intel=await db.from('ci_employer_intelligence').insert({company_id:j.company_id,job_id:body.job_id,claim:'Recruiter reply suggests a role-specific geographic restriction',scope:'job',evidence_source_url:body.source_url,authority:'self_reported',status:'unverified'});
        if(intel.error)console.error('ci-api employer intelligence insert failed');
      }
      return reply(200,{id:record.id,event_type:eventType});
    }
    return reply(404,{error:'Not found'});
  }catch(error){return fail(error);}
});
