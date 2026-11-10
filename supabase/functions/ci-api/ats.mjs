/* Fixed public ATS API endpoints. No arbitrary provider-supplied fetch URLs. */
export const providers = new Set(['greenhouse','lever','ashby']);
const slugPattern=/^[A-Za-z0-9_-]{1,100}$/;
const titles=/engineer|developer|platform|devops|infrastructure|machine learning|research|software|backend|frontend|security|data scientist/i;
export function validBoard(value) {
  return !!value && providers.has(value.provider) && slugPattern.test(value.slug||'') &&
    typeof value.company==='string' && value.company.trim().length>=2 && value.company.trim().length<=180;
}
export function boardEndpoint(provider,slug){
  if(!providers.has(provider)||!slugPattern.test(slug||'')) throw new Error('Invalid ATS source');
  const part=encodeURIComponent(slug);
  switch(provider){
    case 'greenhouse': return 'https://boards-api.greenhouse.io/v1/boards/'+part+'/jobs?content=true';
    case 'lever': return 'https://api.lever.co/v0/postings/'+part+'?mode=json';
    case 'ashby': return 'https://api.ashbyhq.com/posting-api/job-board/'+part;
  }
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
export function normalizeBoard(payload,provider,slug,company,now=Date.now()){
  if(!validBoard({provider,slug,company}))throw new Error('Invalid ATS board');
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.jobs)?payload.jobs:undefined;
  if(!rows)throw new Error('Invalid ATS payload');
  const results=[];
  for(const row of rows.slice(0,100)){
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
    if(!titles.test(title)||title.length>250||!/^[A-Za-z0-9_-]{1,150}$/.test(id)||!url)continue;
    if(pub&&(new Date(pub).getTime()>now+86400000 || new Date(pub).getTime()<now-30*86400000))continue;
    results.push({provider,board:slug,sourceJobId:id,company,title,url,publishedAt:pub,remoteText:String(remote).slice(0,500)});
  }
  return results;
}
