// Career Intelligence server-only gateway. NEVER expose the service-role key.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import {route,validApplication,validDraft,validReply,classifyReply,roleRestricted} from './policy.mjs';

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
        const [e,m,sources]=await Promise.all([
          db.from('ci_eligibility_assessments').select('job_id,status,assessed_at').in('job_id',ids).order('assessed_at',{ascending:false}).limit(1000),
          db.from('ci_job_matches').select('job_id,score,computed_at').in('job_id',ids).order('computed_at',{ascending:false}).limit(1000),
          db.from('ci_job_sources').select('job_id,source_name').in('job_id',ids).order('retrieved_at',{ascending:false}).limit(1000),
        ]);
        const es=new Map<string,string>(),ms=new Map<string,number>(),ss=new Map<string,string>();
        for(const item of list(check(e)))if(!es.has(item.job_id))es.set(item.job_id,item.status);
        for(const item of list(check(m)))if(!ms.has(item.job_id))ms.set(item.job_id,item.score);
        for(const item of list(check(sources)))if(!ss.has(item.job_id))ss.set(item.job_id,item.source_name);
        return reply(200,{jobs:jobs.map((j:any)=>({id:j.id,title:j.title,apply_url:j.apply_url,status:j.status,published_at:j.published_at,first_seen_at:j.first_seen_at,company_id:j.company_id,company_name:j.ci_companies?.legal_name||'',eligibility:es.get(j.id)||null,match_score:ms.get(j.id)||0,source:ss.get(j.id)||'unknown'}))});
      }
      if(path==='people'){
        const xs=list(check(await db.from('ci_contacts').select('id,name,current_title,profile_url,company_id,identity_verified,ci_companies(legal_name)').order('created_at',{ascending:false}).limit(100)));
        return reply(200,{contacts:xs.map((j:any)=>({...j,company_name:j.ci_companies?.legal_name||'',ci_companies:undefined}))});
      }
      if(path==='knowledge')return reply(200,{documents:list(check(await db.from('ci_knowledge_documents').select('path,visibility,git_sha,content_sha,updated_at').eq('status','approved').order('path').limit(500)))});
      if(path==='applications'){
        const xs=list(check(await db.from('ci_applications').select('id,job_id,status,applied_at,notes,ci_jobs(title,apply_url),ci_companies(legal_name)').eq('owner_user_id',owner).order('applied_at',{ascending:false,nullsFirst:false}).limit(500)));
        return reply(200,{applications:xs.map((x:any)=>({id:x.id,job_id:x.job_id,status:x.status,applied_at:x.applied_at,notes:x.notes,title:x.ci_jobs?.title||'',apply_url:x.ci_jobs?.apply_url||'',company_name:x.ci_companies?.legal_name||''}))});
      }
      if(path==='outreach')return reply(200,{drafts:list(check(await db.from('ci_outreach_drafts').select('id,job_id,contact_id,subject,body,status,created_at').eq('owner_user_id',owner).order('created_at',{ascending:false}).limit(100)))});
      if(path==='conversations'){
        const xs=list(check(await db.from('ci_conversation_events').select('id,event_type,occurred_at,evidence,ci_jobs(title,ci_companies(legal_name)),ci_contacts(name)').eq('owner_user_id',owner).order('occurred_at',{ascending:false}).limit(100)));
        return reply(200,{events:xs.map((x:any)=>({id:x.id,event_type:x.event_type,occurred_at:x.occurred_at,evidence:x.evidence,title:x.ci_jobs?.title||'',company_name:x.ci_jobs?.ci_companies?.legal_name||'',contact_name:x.ci_contacts?.name||''}))});
      }
      if(path==='operations'){
        const states=list(check(await db.from('ci_workflow_tasks').select('state').limit(1000)));
        const counts:Record<string,number>={};for(const row of states)counts[row.state]=(counts[row.state]??0)+1;
        return reply(200,{states:counts});
      }
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
      let imported=0,skipped=0;
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
        if(ingested.error||!ingested.data)skipped++;else imported++;
      }
      return reply(200,{source:'Remotive',imported,skipped,checked:Math.min(data.jobs.length,100),
        note:'These are public listings only. Hiring eligibility has not been verified.'});
    }
    let body:any;
    try{body=await request.json();}catch{return reply(400,{error:'Invalid JSON body'});}
    if(operation.type==='application'){
      if(!validApplication(body))return reply(422,{detail:'Invalid application input'});
      const j=check(await db.from('ci_jobs').select('company_id').eq('id',body.job_id).maybeSingle());
      if(!j)return reply(404,{detail:'Job not found'});
      const record=check(await db.from('ci_applications').upsert({owner_user_id:owner,company_id:j.company_id,job_id:body.job_id,status:body.status,notes:body.notes||'',applied_at:body.status==='applied'?new Date().toISOString():null},{onConflict:'owner_user_id,job_id'}).select('id').single());
      return reply(200,{id:record.id});
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
