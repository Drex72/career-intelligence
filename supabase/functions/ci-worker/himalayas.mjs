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
export function analyzeHimalayas(payload,now=Date.now(),keywords=[]){
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
    const rule=himalayasLocationRule(raw?.locationRestrictions);
    if(!roleMatches(title,keywords)){reject('role',title);continue;}
    if(company.length<2||company.length>180||!source||!application||
       source.hostname!=='himalayas.app'||!/^\/companies\/[A-Za-z0-9_-]+\/jobs\/[A-Za-z0-9_-]+$/.test(source.pathname)||
       source.search||source.hash){reject('source',title);continue;}
    if(!Number.isSafeInteger(published)||!Number.isFinite(publishedMs)||
       publishedMs<now-7*86400000||publishedMs>now+86400000){reject('stale',title);continue;}
    // Location rule is job-board evidence, labelled as such at delivery; never official eligibility.
    result.push({
      guid:source.origin+source.pathname,
      company,title,
      applicationLink:String(raw.applicationLink), // exact provider-supplied URL
      // pubDate is a provider update timestamp, not verified first publication.
      lastUpdatedAt:new Date(publishedMs).toISOString(),
      // Job-board location rule (structured). Recorded separately with its source.
      rule,
      locations:rule?(rule.worldwide?'Worldwide (per Himalayas)':
        'Location restrictions (per Himalayas): '+rule.countries.slice(0,30).join(', ')):'Restrictions not recognised',
      // Used only for extracting bounded human-reviewable ATS links. Never render raw HTML.
      description:String(raw?.description||'').slice(0,30000)
    });
  }
  return {jobs:result,scanned:jobs.slice(0,20).length,excluded,samples};
}
export function normalizeHimalayas(payload,now=Date.now(),keywords=[]){
 return analyzeHimalayas(payload,now,keywords).jobs;
}

/** Cursor tokens are opaque. URL-encode; never turn provider data into request URLs. */
export function safeHimalayasCursor(raw,seen=new Set()){
  if(typeof raw!=='string'||raw.length===0||raw.length>512||seen.has(raw))return null;
  return raw;
}

/** Owner role keywords decide the role filter; without any, keep the engineering default. */
export function roleMatches(title,keywords=[]){
  const t=String(title||'').trim();
  if(t.length<3||t.length>250)return false;
  const list=Array.isArray(keywords)?keywords.filter(k=>typeof k==='string'&&k.trim().length>=2):[];
  if(!list.length)return isSoftwareRole(t);
  const lower=t.toLowerCase();
  return list.some(k=>lower.includes(k.trim().toLowerCase()));
}

let nameToCode=null;
function countryNames(){
  if(nameToCode)return nameToCode;
  nameToCode=new Map();
  const display=new Intl.DisplayNames(['en'],{type:'region'});
  for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
    const code=String.fromCharCode(a,b);
    let name;
    try{name=display.of(code);}catch{continue;}
    if(name&&name!==code)nameToCode.set(name.toLowerCase(),code);
  }
  // Common provider spellings that differ from CLDR English names.
  for(const [alias,code] of [['united states of america','US'],['usa','US'],['uk','GB'],
    ['great britain','GB'],['south korea','KR'],['north korea','KP'],['russia','RU'],
    ['vietnam','VN'],['czech republic','CZ'],['ivory coast','CI'],["cote d'ivoire",'CI'],
    ['hong kong','HK'],['macau','MO'],['palestine','PS'],['turkey','TR'],['türkiye','TR'],
    ['democratic republic of the congo','CD'],['republic of the congo','CG'],['eswatini','SZ'],
    ['myanmar','MM'],['burma','MM'],['taiwan','TW'],['laos','LA'],['syria','SY'],['iran','IR'],
    ['bolivia','BO'],['venezuela','VE'],['tanzania','TZ'],['moldova','MD'],['brunei','BN'],
    ['cape verde','CV'],['micronesia','FM'],['vatican city','VA'],['north macedonia','MK'],
    ['macedonia','MK'],['east timor','TL'],['timor-leste','TL'],['curacao','CW'],['curaçao','CW'],
    // ISO 3166 official short names used by Himalayas.
    ['cabo verde','CV'],['congo','CG'],['congo, the democratic republic of the','CD'],
    ["côte d'ivoire",'CI'],['holy see (vatican city state)','VA'],['palestine, state of','PS'],
    ['sao tome and principe','ST'],['sint maarten (dutch part)','SX'],['saint martin (french part)','MF'],
    ['syrian arab republic','SY'],['bonaire, sint eustatius and saba','BQ'],
    ['falkland islands (malvinas)','FK'],['virgin islands, british','VG'],['virgin islands, u.s.','VI'],
    ['heard island and mcdonald islands','HM'],['south georgia and the south sandwich islands','GS'],
    ['saint helena, ascension and tristan da cunha','SH'],['iran, islamic republic of','IR'],
    ['korea, republic of','KR'],["korea, democratic people's republic of",'KP'],
    ['tanzania, united republic of','TZ'],['moldova, republic of','MD'],['bolivia, plurinational state of','BO'],
    ['venezuela, bolivarian republic of','VE'],["lao people's democratic republic",'LA'],
    ['micronesia, federated states of','FM'],['russian federation','RU'],['viet nam','VN'],
    ['taiwan, province of china','TW'],['brunei darussalam','BN'],
    ['saint vincent and the grenadines','VC']])
    nameToCode.set(alias,code);
  return nameToCode;
}
function lookupName(name){
  const map=countryNames();
  const lower=name.toLowerCase();
  // CLDR writes "&" and "St." where ISO names use "and" and "Saint".
  for(const candidate of [lower,lower.replace(/ and /g,' & '),
    lower.replace(/^saint /,'st. '),lower.replace(/^saint /,'st. ').replace(/ and /g,' & ')]){
    const code=map.get(candidate);
    if(code)return code;
  }
  return null;
}
/** ISO alpha-2 code for a provider country entry ({alpha2,name} object or a plain name). */
export function countryCode(entry){
  const alpha=typeof entry==='object'&&entry?entry.alpha2:null;
  if(typeof alpha==='string'&&/^[A-Za-z]{2}$/.test(alpha))return alpha.toUpperCase();
  const name=String((typeof entry==='object'&&entry)?(entry.name||''):(entry||'')).trim();
  if(/^[A-Z]{2}$/.test(name))return name;
  return name?lookupName(name):null;
}
/** Himalayas: an empty restriction list means worldwide. Unrecognised names are dropped,
 *  and a list with no recognised country yields no rule (never a guess). */
export function himalayasLocationRule(restrictions){
  if(!Array.isArray(restrictions))return null;
  if(restrictions.length===0)return {worldwide:true,countries:[],unrecognised:0};
  const countries=new Set();let unrecognised=0;
  for(const entry of restrictions.slice(0,300)){
    const code=countryCode(entry);
    if(code)countries.add(code);else unrecognised++;
  }
  if(!countries.size)return null;
  return {worldwide:false,countries:[...countries].sort(),unrecognised};
}
/** Fixed search endpoint. Only validated owner settings reach the query string. */
export function himalayasSearchURL(country,keyword,page){
  if(!/^[A-Z]{2}$/.test(String(country||'')))throw new Error('Invalid country');
  if(!Number.isSafeInteger(page)||page<1||page>1000)throw new Error('Invalid page');
  const params=new URLSearchParams({country,sort:'recent',page:String(page)});
  if(keyword){
    if(typeof keyword!=='string'||!/^[A-Za-z0-9 +#./-]{2,60}$/.test(keyword))throw new Error('Invalid keyword');
    params.set('q',keyword.trim());
  }
  return 'https://himalayas.app/jobs/api/search?'+params.toString();
}
