/** Country names and plain-language summaries for the owner's search target. */
let cache=null;
export function countryOptions(){
  if(cache)return cache;
  const names=new Intl.DisplayNames(['en'],{type:'region'});
  const out=[];
  for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
    const code=String.fromCharCode(a,b);
    let name;
    try{name=names.of(code);}catch{continue;}
    if(name&&name!==code&&!/unknown/i.test(name))out.push({code,name});
  }
  cache=out.sort((x,y)=>x.name.localeCompare(y.name));
  return cache;
}
export function countryName(code){
  if(typeof code!=='string'||!/^[A-Z]{2}$/.test(code))return null;
  return countryOptions().find(c=>c.code===code)?.name??code;
}
/** Comma separated input to a clean keyword list (trimmed, de-duplicated, case-insensitive). */
export function parseKeywords(text){
  const seen=new Set();const out=[];
  for(const raw of String(text||'').split(',')){
    const k=raw.trim().replace(/\s+/g,' ');
    if(!k||seen.has(k.toLowerCase()))continue;
    seen.add(k.toLowerCase());out.push(k);
  }
  return out;
}
export const KEYWORD_PATTERN=/^[A-Za-z0-9 +#./-]{2,60}$/;
export function keywordError(list){
  if(list.length>8)return 'Use at most 8 role keywords.';
  const bad=list.find(k=>!KEYWORD_PATTERN.test(k));
  if(bad)return '“'+bad.slice(0,30)+'” can only use letters, numbers, spaces and + # . / - (2–60 characters).';
  return null;
}
/** One sentence describing what the system searches for. */
export function targetSummary(target){
  if(!target)return 'No search target saved yet.';
  const roles=target.role_keywords?.length?target.role_keywords.join(', '):'software engineering';
  const where=countryName(target.applicant_country)||target.applicant_country;
  const employer=target.employer_country?(' at employers based in '+countryName(target.employer_country)):'';
  const text=roles+' roles open to applicants in '+where+employer+'.';
  return text.charAt(0).toUpperCase()+text.slice(1);
}
