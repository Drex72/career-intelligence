/** Free remote job boards beyond Himalayas: Jobicy (JSON API) and We Work Remotely (RSS).
 *  Both are job-board evidence only. Each listing keeps the board's own job URL, which is
 *  what both boards ask for (credit with a direct link; apply through the original URL). */
import {countryCode,isSoftwareRole,roleMatches} from './himalayas.mjs';

const WORLDWIDE=new Set(['anywhere','worldwide','global','anywhere in the world','work from anywhere',
  'remote worldwide','worldwide remote','remote - worldwide','remote (worldwide)','remote, worldwide',
  'remote anywhere','100% remote worldwide']);

/** Board free-text location to a structured rule. Only an exact worldwide phrase counts as
 *  worldwide; otherwise each comma/slash-separated piece must be a plain country name.
 *  Regions ("EMEA", "Europe"), qualifiers ("except …", "timezones") and unknown text are
 *  dropped, so a rule can only be narrower than the board's text, never wider. */
export function textLocationRule(text){
  const raw=String(text||'').toLowerCase().replace(/\s+/g,' ').trim();
  if(!raw||raw.length>500)return null;
  if(WORLDWIDE.has(raw))return {worldwide:true,countries:[]};
  if(/\b(?:except|excluding|not|outside)\b/.test(raw))return null;
  const countries=new Set();
  for(let piece of raw.split(/\s*(?:,|;|\/|\||\bor\b|\band\b|&)\s*/)){
    piece=piece.replace(/^remote\s*[-–:(]?\s*/,'').replace(/[)]$/,'').replace(/\s+only$/,'').trim();
    if(piece.length<2)continue;
    const code=countryCode(piece);
    if(code)countries.add(code);
  }
  if(!countries.size)return null;
  return {worldwide:false,countries:[...countries].sort()};
}

function wanted(title,keywords){return isSoftwareRole(title)||(keywords.length>0&&roleMatches(title,keywords));}
function boardURL(input,host,prefix){
  try{
    const u=new URL(String(input||''));
    if(u.protocol!=='https:'||u.hostname!==host||!u.pathname.startsWith(prefix)||
       u.pathname.length<=prefix.length||u.username||u.password||u.port)return null;
    return u.origin+u.pathname;
  }catch{return null;}
}
function audit(){
  const excluded={role:0,source:0,stale:0};const samples=[];
  return {excluded,samples,reject(reason,title){excluded[reason]++;
    if(samples.length<3&&title)samples.push({reason,title:String(title).slice(0,180)});}};
}
function fresh(ms,now){return Number.isFinite(ms)&&ms>=now-7*86400000&&ms<=now+86400000;}

/** Jobicy v2 remote-jobs payload (requested with geo=anywhere). */
export function analyzeJobicy(payload,now=Date.now(),keywords=[]){
  const list=payload?.jobs;
  if(!Array.isArray(list))throw new Error('Unexpected Jobicy API format');
  const a=audit();const jobs=[];
  const rows=list.slice(0,100);
  for(const raw of rows){
    const title=String(raw?.jobTitle||'').trim();
    const company=String(raw?.companyName||'').trim();
    const id=String(raw?.id||'');
    const url=boardURL(raw?.url,'jobicy.com','/jobs/');
    const published=Date.parse(String(raw?.pubDate||''));
    if(!wanted(title,keywords)){a.reject('role',title);continue;}
    if(!/^\d{1,20}$/.test(id)||!url||company.length<2||company.length>180||title.length>250){a.reject('source',title);continue;}
    if(!fresh(published,now)){a.reject('stale',title);continue;}
    const location=String(raw?.jobGeo||'').slice(0,500);
    jobs.push({source:'jobicy',sourceId:id,company,title,url,published:new Date(published).toISOString(),
      location,rule:textLocationRule(location)});
  }
  return {jobs,scanned:rows.length,excluded:a.excluded,samples:a.samples};
}

function decode(s){
  return String(s||'').replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/,'$1')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&#(\d{1,6});/g,(_,n)=>{const c=Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';})
    .replace(/&amp;/g,'&').trim();
}
function tag(item,name){
  const m=item.match(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>'));
  return m?decode(m[1]):'';
}
const WWR_PREFIX='/remote-jobs/';
/** We Work Remotely RSS. Titles are "Company: Role"; region/country carry the location rule. */
export function analyzeWWR(xml,now=Date.now(),keywords=[]){
  if(typeof xml!=='string'||!xml.includes('<rss'))throw new Error('Unexpected We Work Remotely feed format');
  const items=xml.match(/<item>[\s\S]*?<\/item>/g)||[];
  const a=audit();const jobs=[];
  const rows=items.slice(0,200);
  for(const item of rows){
    const full=tag(item,'title');
    const split=full.indexOf(': ');
    const company=split>0?full.slice(0,split).trim():'';
    const title=split>0?full.slice(split+2).trim():full;
    const url=boardURL(tag(item,'link')||tag(item,'guid'),'weworkremotely.com',WWR_PREFIX);
    const published=Date.parse(tag(item,'pubDate'));
    if(!wanted(title,keywords)){a.reject('role',title);continue;}
    if(!url||company.length<2||company.length>180||title.length<3||title.length>250){a.reject('source',title);continue;}
    if(!fresh(published,now)){a.reject('stale',title);continue;}
    // A named country is more specific than the region; otherwise use the region text.
    const location=(tag(item,'country')||tag(item,'region')).slice(0,500);
    const slug=new URL(url).pathname.slice(WWR_PREFIX.length).slice(0,200);
    jobs.push({source:'weworkremotely',sourceId:slug,company,title,url,
      published:new Date(published).toISOString(),location,rule:textLocationRule(location)});
  }
  return {jobs,scanned:rows.length,excluded:a.excluded,samples:a.samples};
}
