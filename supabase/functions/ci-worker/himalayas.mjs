/** Himalayas official API normalization. Provider terms require unmodified applicationLink. */
const positions=/engineer|developer|platform|devops|infrastructure|machine learning|research|software|backend|frontend|security|data scientist/i;
function safeURL(input){
  try{
    const url=new URL(String(input||''));
    if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    return url;
  }catch{return null;}
}
export function normalizeHimalayas(payload,now=Date.now()){
  const jobs=payload?.jobs;
  if(!Array.isArray(jobs))throw new Error('Unexpected Himalayas API format');
  const result=[];
  for(const raw of jobs.slice(0,20)){
    const title=String(raw?.title||'').trim();
    const company=String(raw?.companyName||'').trim();
    const source=safeURL(raw?.guid);
    const application=safeURL(raw?.applicationLink);
    const published=Number(raw?.pubDate);
    const publishedMs=published*1000;
    const restrictions=Array.isArray(raw?.locationRestrictions)?
      raw.locationRestrictions.map(x=>String(x?.alpha2||x?.name||'')).filter(Boolean).slice(0,30):[];
    if(!positions.test(title)||title.length<3||title.length>250||
       company.length<2||company.length>180||!source||!application||
       source.hostname!=='himalayas.app'||!/^\/companies\/[A-Za-z0-9_-]+\/jobs\/[A-Za-z0-9_-]+$/.test(source.pathname)||
       source.search||source.hash||!Number.isSafeInteger(published)||!Number.isFinite(publishedMs)||
       publishedMs<now-7*86400000||publishedMs>now+86400000)continue;
    // No inferred legal eligibility from a worldwide tag or country metadata.
    result.push({
      guid:source.origin+source.pathname,
      company,title,
      applicationLink:String(raw.applicationLink), // exact provider-supplied URL
      publishedAt:new Date(publishedMs).toISOString(),
      locations:restrictions.length?'Location restrictions: '+restrictions.join(', '):'Restrictions not verified',
      // Used only for extracting bounded human-reviewable ATS links. Never render raw HTML.
      description:String(raw?.description||'').slice(0,30000)
    });
  }
  return result;
}

/** Cursor tokens are opaque. URL-encode; never turn provider data into request URLs. */
export function safeHimalayasCursor(raw,seen=new Set()){
  if(typeof raw!=='string'||raw.length===0||raw.length>512||seen.has(raw))return null;
  return raw;
}
