/** Public-only source-backed people research; never invent email or connection claims. */
const domainPattern=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
export function safeCompanyDomain(value){
  if(typeof value!=='string'||value.length>253||!domainPattern.test(value))return false;
  const lower=value.toLowerCase();
  if(/(^|\.)xn--/.test(lower)||/\.(?:local|localhost|internal|test|example|invalid)$/.test(lower))return false;
  if(lower==='localhost'||lower.endsWith('.localhost'))return false;
  return true;
}
export function publicAddress(value){
  if(typeof value!=='string')return false;
  if(value.includes(':'))return /^[23][0-9a-f]{3}:/i.test(value);
  const parts=value.split('.').map(Number);
  if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const [a,b,c]=parts;
  if(a===0||a===10||a===127||a>=224||
     (a===100&&b>=64&&b<=127)||
     (a===169&&b===254)||(a===172&&b>=16&&b<=31)||
     (a===192&&[0,168].includes(b))||
     (a===198&&(b===18||b===19))||
     (a===192&&b===0&&c===2)||(a===198&&b===51&&c===100)||
     (a===203&&b===0&&c===113))return false;
  return true;
}
function validProfileURL(raw,domain){
  try{
    const url=new URL(String(raw||''));
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash)return null;
    if(url.hostname!==domain && url.hostname!=='www.'+domain &&
       !(url.hostname==='www.linkedin.com'&&url.pathname.startsWith('/in/')))return null;
    if(url.pathname.length>250)return null;
    return url.origin+url.pathname;
  }catch{return null;}
}
export function extractPublicPeople(html,domain,sourceURL){
  if(!safeCompanyDomain(domain)||typeof html!=='string'||html.length>250000||
     sourceURL!=='https://'+domain+'/team'&&sourceURL!=='https://'+domain+'/about')return [];
  const scripts=html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[];
  const people=new Map();
  function scan(value,depth=0){
    if(depth>4||people.size>=5||!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const item of value.slice(0,50))scan(item,depth+1);return;}
    const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];
    if(types.includes('Person')){
      const name=String(value.name||'').trim();
      const title=String(value.jobTitle||'').trim();
      const alternatives=Array.isArray(value.sameAs)?value.sameAs:[value.sameAs];
      const profile=validProfileURL(value.url,domain)||
        alternatives.map(x=>validProfileURL(x,domain)).find(Boolean);
      if(name.length>=3&&name.length<=120&&title.length>=3&&title.length<=150&&profile)
        people.set(profile,{name,title,profileURL:profile,sourceURL});
    }
    if(value['@graph'])scan(value['@graph'],depth+1);
    if(value.employee)scan(value.employee,depth+1);
    if(value.member)scan(value.member,depth+1);
  }
  for(const script of scripts.slice(0,30)){
    const open=script.slice(0,script.indexOf('>')+1);
    if(!/\btype\s*=\s*["']?application\/ld\+json/i.test(open))continue;
    const raw=script.slice(open.length).replace(/<\/script>\s*$/i,'').trim();
    try{scan(JSON.parse(raw));}catch{continue;}
  }
  return [...people.values()].slice(0,5);
}
