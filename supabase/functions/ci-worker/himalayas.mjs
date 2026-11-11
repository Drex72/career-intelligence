/** Himalayas official API normalization. Provider terms require unmodified applicationLink. */
/** Software/backend/AI engineering intent. Generic "engineer" and "research" are insufficient. */
export function isSoftwareRole(input) {
  const title=String(input||'').trim();
  if(title.length<3||title.length>250)return false;
  if(/\b(?:sales engineer|sales engineering|sales solutions|business development|digital research analyst|investigator|customer success|life sciences research expert)\b/i.test(title))return false;
  const engineering=/\b(?:software|backend|back-end|frontend|front-end|full[ -]?stack|web|cloud|platform|infrastructure|devops|site reliability|sre|machine learning|ml|ai|artificial intelligence|systems|data|cybersecurity|security|python|typescript|javascript|java|rust|golang|node(?:\.js)?)\b/i;
  const role=/\b(?:engineer|developer|architect|programmer|research engineer)\b/i;
  return /\bdeveloper\b/i.test(title) || (engineering.test(title)&&role.test(title));
}
function safeURL(input){
  try{
    const url=new URL(String(input||''));
    if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    return url;
  }catch{return null;}
}
export function analyzeHimalayas(payload,now=Date.now()){
  const jobs=payload?.jobs;
  if(!Array.isArray(jobs))throw new Error('Unexpected Himalayas API format');
  const result=[];
  const excluded={role:0,source:0,stale:0};
  const samples=[];
  function reject(reason,title){excluded[reason]++;if(samples.length<3&&title)samples.push({reason,title:title.slice(0,180)});}
  for(const raw of jobs.slice(0,20)){
    const title=String(raw?.title||'').trim();
    const company=String(raw?.companyName||'').trim();
    const source=safeURL(raw?.guid);
    const application=safeURL(raw?.applicationLink);
    const published=Number(raw?.pubDate);
    const publishedMs=published*1000;
    const restrictions=Array.isArray(raw?.locationRestrictions)?
      raw.locationRestrictions.map(x=>String(x?.alpha2||x?.name||'')).filter(Boolean).slice(0,30):[];
    if(!isSoftwareRole(title)){reject('role',title);continue;}
    if(company.length<2||company.length>180||!source||!application||
       source.hostname!=='himalayas.app'||!/^\/companies\/[A-Za-z0-9_-]+\/jobs\/[A-Za-z0-9_-]+$/.test(source.pathname)||
       source.search||source.hash){reject('source',title);continue;}
    if(!Number.isSafeInteger(published)||!Number.isFinite(publishedMs)||
       publishedMs<now-7*86400000||publishedMs>now+86400000){reject('stale',title);continue;}
    // No inferred legal eligibility from a worldwide tag or country metadata.
    result.push({
      guid:source.origin+source.pathname,
      company,title,
      applicationLink:String(raw.applicationLink), // exact provider-supplied URL
      // pubDate is a provider update timestamp, not verified first publication.
      lastUpdatedAt:new Date(publishedMs).toISOString(),
      locations:restrictions.length?'Location restrictions: '+restrictions.join(', '):'Restrictions not verified',
      // Used only for extracting bounded human-reviewable ATS links. Never render raw HTML.
      description:String(raw?.description||'').slice(0,30000)
    });
  }
  return {jobs:result,scanned:jobs.slice(0,20).length,excluded,samples};
}
export function normalizeHimalayas(payload,now=Date.now()){
 return analyzeHimalayas(payload,now).jobs;
}

/** Cursor tokens are opaque. URL-encode; never turn provider data into request URLs. */
export function safeHimalayasCursor(raw,seen=new Set()){
  if(typeof raw!=='string'||raw.length===0||raw.length>512||seen.has(raw))return null;
  return raw;
}
