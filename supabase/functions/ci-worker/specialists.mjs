/* Independently executable, non-sending specialist stages.
 * No Gmail credentials, LLM-originated sends, guessed contact emails,
 * browser-auth impersonation, or private-profile scraping.
 */
const EMAIL_SAFE=/\b(?:do not contact|unsubscribe|stop emailing|remove me)\b/i;
export function classifyReply(text){
 if(EMAIL_SAFE.test(text))return 'opt_out';
 if(/\b(?:refer you|referral submitted|happy to refer)\b/i.test(text))return 'referral';
 if(/\b(?:interview|schedule a call|speak with the team)\b/i.test(text))return 'interview';
 if(/\b(?:not hiring|unfortunately|not interested)\b/i.test(text))return 'declined';
 return 'other';
}
export function safeVerifiedDomain(domain){
 return typeof domain==='string'&&domain.length<=180&&
 /^[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,24}$/i.test(domain)&&
 !/(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion)$/i.test(domain)&&
 !/(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion)\./i.test(domain);
}
export function extractOfficialPeople(html,domain){
 if(typeof html!=='string'||html.length>1024*1024||!safeVerifiedDomain(domain))return [];
 const found=new Map();
 const re=/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
 let match;let count=0;
 function walk(node,depth=0){
  if(depth>12||found.size>=5||!node)return;
  if(Array.isArray(node)){for(const child of node.slice(0,80))walk(child,depth+1);return;}
  if(typeof node!=='object')return;
  const kind=node['@type'];
  if(kind==='Person'||Array.isArray(kind)&&kind.includes('Person')){
   const name=String(node.name||'').trim(),title=String(node.jobTitle||'').trim();
   try{
    const link=new URL(String(node.url||''),'https://'+domain);
    if(name.length>=3&&name.length<=150&&title.length>=3&&title.length<=180&&
       link.protocol==='https:'&&link.hostname.toLowerCase()===domain.toLowerCase()&&
       !link.username&&!link.password&&!link.port){
      found.set(link.origin+link.pathname,{name,title,url:link.origin+link.pathname});
    }
   }catch{}
  }
  for(const value of Object.values(node).slice(0,80))
   if(value&&typeof value==='object')walk(value,depth+1);
 }
 while((match=re.exec(html))&&count++<15){
  try{walk(JSON.parse(match[1]));}catch{}
 }
 return [...found.values()].slice(0,5);
}
async function failTask(db,id,workerId,state,nextRetry=null){
 await db.from('ci_workflow_tasks').update({state,lease_until:null,worker_id:null,
  updated_at:new Date().toISOString(),next_retry_at:nextRetry})
  .eq('id',id).eq('state','leased').eq('worker_id',workerId);
}
export async function runPeople(db,runID,recordStage){
 const data=await db.from('ci_workflow_tasks').select('id,input_ref,attempt_count,max_attempts')
  .eq('task_type','people_research').in('state',['pending','retry_wait'])
  .order('created_at').limit(30);
 if(data.error)throw new Error('people queue unreadable');
 let processed=0;
 for(const task of data.data||[]){
  if(processed>=2)break;
  if(task.state==='retry_wait'&&task.next_retry_at&&new Date(task.next_retry_at)>new Date())continue;
  const leased=await db.from('ci_workflow_tasks').update({state:'leased',worker_id:runID,
   lease_until:new Date(Date.now()+120000).toISOString(),attempt_count:task.attempt_count+1})
   .eq('id',task.id).eq('state',task.state).select('id').maybeSingle();
  if(leased.error||!leased.data)continue;
  processed++;
  const id=String(task.input_ref||'').startsWith('company:')?task.input_ref.slice(8):'';
  try{
   const company=await db.from('ci_companies').select('id,canonical_domain,identity_confidence')
    .eq('id',id).maybeSingle();
   const domain=company.data?.canonical_domain;
   if(company.error||company.data?.identity_confidence!=='verified'||!safeVerifiedDomain(domain)){
    await failTask(db,task.id,runID,'blocked');
    await recordStage('people','people_researcher','research_blocked',{company:id},
      {reason:'verified_employer_domain_required'});continue;
   }
   const url='https://'+domain+'/team';
   const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(12000),
     headers:{accept:'text/html','user-agent':'CareerIntelligencePublicContactResearch/1.0'}});
   if(!res.ok||!String(res.headers.get('content-type')||'').includes('text/html')||
      Number(res.headers.get('content-length')||0)>1024*1024)throw new Error('official_team_page_unavailable');
   const html=await res.text();
   const people=extractOfficialPeople(html,domain);
   for(const person of people){
    const written=await db.from('ci_contacts').upsert({
     company_id:id,name:person.name,current_title:person.title,
     profile_url:person.url,profile_source_url:url,identity_verified:true
    },{onConflict:'company_id,profile_url'});
    if(written.error)throw new Error('contact provenance write failed');
   }
   await failTask(db,task.id,runID,people.length?'completed':'blocked');
   await recordStage('people','people_researcher','official_people_checked',
     {company:id,source:'verified_employer_team_page'},
     {verified_contacts:people.length,status:people.length?'completed':'no_structured_contacts'});
  }catch{
   await failTask(db,task.id,runID,
    task.attempt_count+1>=task.max_attempts?'blocked':'retry_wait',
    new Date(Date.now()+3600000).toISOString());
   await recordStage('people','people_researcher','research_retry',
     {company:id},{status:'retry_wait_or_blocked'});
  }
 }
 return processed;
}
export async function runOutreach(db,runID,recordStage){
 // The owner must have actually applied; this prepares drafts ONLY.
 const notes=await db.from('ci_knowledge_documents')
  .select('id,content_sha').eq('status','approved').eq('visibility','outreach-safe').limit(10);
 if(notes.error||!notes.data?.length)return 0;
 const versions=await db.from('ci_knowledge_versions').select('document_id,revision,body')
  .in('document_id',notes.data.map(n=>n.id))
  .in('revision',notes.data.map(n=>n.content_sha)).limit(20);
 if(versions.error)return 0;
 const trusted=notes.data.flatMap(n=>(versions.data||[])
  .filter(v=>v.document_id===n.id&&v.revision===n.content_sha&&typeof v.body==='string')
  .map(v=>v.body.trim())).filter(Boolean);
 if(!trusted.length)return 0;
 const applications=await db.from('ci_applications')
  .select('owner_user_id,job_id,applied_at,status')
  .in('status',['applied','interviewing','offer']).not('applied_at','is',null).limit(35);
 if(applications.error)throw new Error('applications unreadable');
 let drafted=0;
 for(const app of applications.data||[]){
  if(drafted>=4)break;
  const job=await db.from('ci_jobs').select('id,title,status,company_id')
    .eq('id',app.job_id).maybeSingle();
  if(job.error||job.data?.status!=='open')continue;
  const assessment=await db.from('ci_eligibility_assessments')
    .select('status,expires_at').eq('job_id',app.job_id)
    .order('assessed_at',{ascending:false}).limit(1).maybeSingle();
  if(assessment.error||assessment.data?.status!=='verified_eligible'||
    assessment.data?.expires_at&&new Date(assessment.data.expires_at)<=new Date())continue;
  const contacts=await db.from('ci_contacts').select('id,name')
    .eq('company_id',job.data.company_id).eq('identity_verified',true).limit(5);
  if(contacts.error)continue;
  for(const contact of contacts.data||[]){
   if(drafted>=4)break;
   const existing=await db.from('ci_outreach_drafts').select('id')
    .eq('owner_user_id',app.owner_user_id).eq('job_id',app.job_id)
    .eq('contact_id',contact.id).limit(1);
   if(existing.error||existing.data?.length)continue;
   const company=await db.from('ci_companies').select('legal_name')
    .eq('id',job.data.company_id).maybeSingle();
   const first=String(contact.name).split(/\s+/)[0].slice(0,60);
   const organization=company.data?.legal_name||'your organization';
   const subject='Question about '+job.data.title+' at '+organization;
   // Intentionally do not quote personal vault notes verbatim in automatic outreach.
   const body='Hi '+first+',\n\nI recently applied for the '+job.data.title+
    ' position at '+organization+'. I have worked on software infrastructure and engineering projects and would appreciate learning more about the team and its work.\n\nWould you be open to a brief conversation?\n\nBest regards';
   const created=await db.from('ci_outreach_drafts').insert({
     owner_user_id:app.owner_user_id,job_id:app.job_id,contact_id:contact.id,
     subject:subject.slice(0,250),body,knowledge_revision:notes.data[0].content_sha,
     personalization_evidence:[{kind:'application_recorded',job_id:app.job_id}],
     status:'draft'
   });
   if(created.error)continue;
   drafted++;
   await recordStage('outreach','outreach_preparer','draft_created',
     {job_id:app.job_id,source:'approved_profile_and_application'},
     {status:'draft_requires_review'});
  }
 }
 return drafted;
}
export async function runConversation(db,runID,recordStage){
 const pending=await db.from('ci_conversation_events')
  .select('id,owner_user_id,job_id,contact_id,provider_message_id,evidence')
  .eq('event_type','reply_received').not('provider_message_id','is',null)
  .order('occurred_at').limit(30);
 if(pending.error)throw new Error('conversation queue unreadable');
 let processed=0;
 for(const event of pending.data||[]){
  if(processed>=12)break;
  const prior=await db.from('ci_conversation_events').select('id')
   .eq('provider_message_id',event.provider_message_id)
   .eq('event_type','reply_classified').limit(1);
  if(prior.error||prior.data?.length)continue;
  // Only classify actual imported replies. No mailbox connection = no work.
  const summary=String(event.evidence?.body||'').slice(0,2000);
  const category=summary?classifyReply(summary):'needs_review';
  const result=await db.from('ci_conversation_events').insert({
   owner_user_id:event.owner_user_id,job_id:event.job_id,
   contact_id:event.contact_id,provider_message_id:event.provider_message_id,
   event_type:'reply_classified',
   evidence:{category,source_event:event.id,classification:'deterministic_v1'}
  });
  if(result.error)continue;
  processed++;
  await recordStage('conversation','conversation_tracker','reply_classified',
   {job_id:event.job_id,source:'imported_reply'},
   {category,status:'reviewable'});
 }
 return processed;
}
