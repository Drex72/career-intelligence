/* Fixed public ATS API endpoints. No arbitrary provider-supplied fetch URLs. */
export const providers = new Set(['greenhouse','lever','ashby']);
const slugPattern=/^[A-Za-z0-9_-]{1,100}$/;
const titles=/engineer|developer|platform|devops|infrastructure|machine learning|research|software|backend|frontend|security|data scientist/i;
// Scan at most 500 entries from a validated provider payload; preserve existing
// 40-per-board ingestion cap downstream and the 2MB HTTP response limit.
export const MAX_ATS_POSTINGS_SCREENED=500;
export function validBoard(value) {
  return !!value && providers.has(value.provider) && slugPattern.test(value.slug||'') &&
    typeof value.company==='string' && value.company.trim().length>=2 && value.company.trim().length<=180;
}
export function boardEndpoint(provider,slug){
  if(!providers.has(provider)||!slugPattern.test(slug||'')) throw new Error('Invalid ATS source');
  const part=encodeURIComponent(slug);
  switch(provider){
    case 'greenhouse': return 'https://boards-api.greenhouse.io/v1/boards/'+part+'/jobs';
    case 'lever': return 'https://api.lever.co/v0/postings/'+part+'?mode=json';
    case 'ashby': return 'https://api.ashbyhq.com/posting-api/job-board/'+part;
  }
}
/** Single-job detail is only accessed for an already-registered Greenhouse job ID.
 * Board listing stays compact; its description is not used to infer eligibility.
 */
export function greenhouseJobDetailEndpoint(slug,id){
  if(!slugPattern.test(slug||'')||!/^[0-9]{1,18}$/.test(String(id||'')))throw new Error('Invalid Greenhouse job');
  return 'https://boards-api.greenhouse.io/v1/boards/'+encodeURIComponent(slug)+'/jobs/'+encodeURIComponent(String(id));
}
function postingURL(raw,provider,slug){
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash) return null;
    const hosts=provider==='greenhouse'?['boards.greenhouse.io','job-boards.greenhouse.io']:
      provider==='lever'?['jobs.lever.co']:['jobs.ashbyhq.com'];
    if(!hosts.includes(u.hostname)||!u.pathname.startsWith('/'+slug+'/'))return null;
    return u.origin+u.pathname;
  }catch{return null;}
}
function published(value){
  if(value===undefined||value===null||value==='') return null;
  const d=typeof value==='number'?new Date(value):new Date(value);
  return Number.isFinite(d.getTime())?d.toISOString():null;
}
export function analyzeBoard(payload,provider,slug,company,now=Date.now()){
  if(!validBoard({provider,slug,company}))throw new Error('Invalid ATS board');
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.jobs)?payload.jobs:undefined;
  if(!rows)throw new Error('Invalid ATS payload');
  const results=[];
  const excluded={role:0,source:0,stale:0};
  const samples=[];
  function reject(reason,title){excluded[reason]++;if(samples.length<3&&title)samples.push({reason,title:title.slice(0,180)});}
  for(const row of rows.slice(0,MAX_ATS_POSTINGS_SCREENED)){
    const title=String(provider==='lever'?row?.text:row?.title||'').trim();
    const id=String(row?.id||'');
    const rawURL=provider==='greenhouse'?row?.absolute_url:provider==='lever'?
      (row?.hostedUrl||row?.applyUrl):(row?.jobUrl||row?.applyUrl);
    const url=postingURL(rawURL,provider,slug);
    const pub=published(provider==='greenhouse'?row?.first_published:
      provider==='lever'?row?.createdAt:row?.publishedAt);
    const remote=provider==='greenhouse'?(row?.location?.name||''):
      provider==='lever'?(row?.workplaceType||''):
      row?.isRemote===true?'Remote':'';
    if(!titles.test(title)||title.length>250){reject('role',title);continue;}
    if(!/^[A-Za-z0-9_-]{1,150}$/.test(id)||!url){reject('source',title);continue;}
    if(pub&&(new Date(pub).getTime()>now+86400000 || new Date(pub).getTime()<now-30*86400000)){reject('stale',title);continue;}
    results.push({provider,board:slug,sourceJobId:id,company,title,url,publishedAt:pub,remoteText:String(remote).slice(0,500)});
  }
  // Provider arrays are not guaranteed to be newest-first. Prefer freshly
  // published valid roles when the separate ingestion budget is exhausted.
  // Unknown publication timestamps remain eligible, but rank after dated roles.
  results.sort((a,b)=>(Date.parse(b.publishedAt||'')||0)-(Date.parse(a.publishedAt||'')||0));
  return {jobs:results,scanned:Math.min(rows.length,MAX_ATS_POSTINGS_SCREENED),excluded,samples};
}
export function normalizeBoard(payload,provider,slug,company,now=Date.now()){
 return analyzeBoard(payload,provider,slug,company,now).jobs;
}
