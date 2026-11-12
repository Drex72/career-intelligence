/** Deterministic, source-scoped eligibility triage. Never treat "remote" alone as Nigeria eligibility. */
export function plainPosting(value) {
  const text=String(value||'').slice(0,30000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&#(\d{1,5});/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),65533)))
    .replace(/\s+/g,' ').trim();
  return text.slice(0,8000);
}
export function findOfficialJob(payload,provider,sourceId) {
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.jobs)?payload.jobs:[];
  if(!/^[A-Za-z0-9_-]{1,150}$/.test(sourceId))return null;
  return rows.slice(0,500).find(row=>String(row?.id)===sourceId)||null;
}
export function postingDescription(posting,provider) {
  if(!posting)return '';
  const raw=provider==='greenhouse'?posting.content:
    provider==='lever'?(posting.descriptionPlain||posting.description):
    provider==='ashby'?(posting.descriptionPlain||posting.descriptionHtml):'';
  return plainPosting(raw);
}
/** Official structured job-location fields, never extracted from free-form marketing copy. */
export function postingLocation(posting,provider) {
  if(!posting)return '';
  if(provider==='ashby'){
    // Official Ashby posting API exposes secondaryLocations as job-scoped
    // structured hiring locations. Do not infer countries from the description.
    const primary=posting.location||posting.address?.postalAddress?.addressCountry;
    const extras=Array.isArray(posting.secondaryLocations)?posting.secondaryLocations.slice(0,16):[];
    const locations=[primary,...extras.map(item=>item?.location||item?.address?.addressCountry)]
      .filter(value=>typeof value==='string'&&value.trim()&&value.length<=100)
      .map(value=>value.trim());
    return [...new Set(locations)].join('; ').slice(0,300);
  }
  const value=provider==='greenhouse'?posting.location?.name:
    provider==='lever'?posting.categories?.location:'';
  return typeof value==='string'?value.slice(0,300).trim():'';
}
const nigeriaLocation=/^(?:nigeria|[^\n]{1,100},\s*nigeria)(?:\s*\((?:remote|hybrid|onsite|on-site)\))?$/i;
/** Structured ATS locations can be semicolon-separated country/city entries.
 * Never infer eligibility from an unstructured paragraph or a continent label.
 * A job's official Nigeria entry is evidence even when other countries appear.
 */
export function hasExplicitNigeriaLocation(value) {
  const location=String(value||'').slice(0,300).trim();
  if(nigeriaLocation.test(location))return true;
  if(!location.includes(';'))return false;
  return location.split(';').length<=30 &&
    location.split(';').some(part=>nigeriaLocation.test(part.trim()));
}

const negative=[
  /\b(?:cannot|can't|can not|do not|don't|unable to|will not|won't)\s+(?:currently\s+)?(?:hire|employ|recruit)\s+(?:applicants|people|candidates|workers)?\s*(?:in|from|based in)\s+nigeria\b/i,
  /\bnigeria\s+(?:is\s+)?(?:not eligible|ineligible|excluded|not a supported|not an eligible)\b/i,
  /\b(?:candidates|applicants)\s+(?:based|located|residing)\s+in\s+nigeria\s+are\s+not\s+(?:eligible|accepted)\b/i,
];
const positive=[
  /\b(?:we\s+)?(?:hire|employ|recruit)\s+(?:engineers|candidates|people|applicants)?\s*(?:in|from)\s+nigeria\b/i,
  /\b(?:applicants|candidates)\s+(?:based|located|residing)\s+in\s+nigeria\s+are\s+(?:eligible|welcome|accepted)\b/i,
  /\bnigeria\s+is\s+an?\s+(?:eligible|supported)\s+(?:hiring\s+)?(?:country|location)\b/i,
  /\b(?:eligible|supported)\s+(?:hiring\s+)?(?:countries|locations)\s*[:\-]\s*[^.!?]{0,70}\bnigeria\b/i,
];
/** Job-scoped remote geography is distinct from legal applicant eligibility.
 * US employer headquarters is also distinct from where the worker must live.
 */
export function classifyRemoteScope(raw,officialLocation='') {
  const text=plainPosting(raw).slice(0,8000);
  const location=String(officialLocation||'').slice(0,300);
  const combined=location+' '+text;
  // Any explicit country-only restriction outranks broad recruiting slogans.
  const restricted=/\b(?:remote[ -]*(?:us|usa|united states|uk|canada|emea|apac|europe)[ -]*only|(?:must|need to) (?:be|reside|live|work) (?:based |located )?in (?:the )?(?:us|usa|united states)|(?:us|usa|united states) (?:residents|citizens|work authorization) (?:only|required)|(?:applicants|candidates) (?:must be|only) (?:based|located) in (?:the )?(?:us|usa|united states)|(?:only|exclusively) (?:hire|hiring|open to) (?:candidates )?(?:in|from) (?:the )?(?:us|usa|united states))\b/i;
  if(restricted.test(combined))return 'restricted';
  const locationGlobal=/^(?:remote\s*[-,(): ]*\s*global|global\s*[-,(): ]*\s*remote|worldwide|remote\s*[-,(): ]*\s*worldwide|anywhere\s+in\s+the\s+world)$/i;
  if(location.split(';').some(part=>locationGlobal.test(part.trim())))return 'worldwide';
  const global=/\b(?:remote\s*[-,(): ]*\s*global|global\s*[-,(): ]*\s*remote|remote\s*[-,(): ]*\s*worldwide|work\s+(?:remotely\s+)?from\s+anywhere(?:\s+in\s+the\s+world)?|(?:you\s+can\s+)?work\s+from\s+anywhere\s+in\s+the\s+world|open\s+to\s+(?:candidates|applicants)\s+worldwide)\b/i;
  return global.test(text)?'worldwide':'unknown';
}

export function classifyOfficialPosting(raw,officialLocation='') {
  const text=plainPosting(raw);
  const remoteScope=classifyRemoteScope(raw,officialLocation);
  if(!text)return {status:'unknown',confidence:0,reason:'No official description text',excerpt:'',remoteScope};
  const location=String(officialLocation||'').slice(0,300).trim();
  const excerpt=(location?'Official job location: '+location+'; ':'')+text.slice(0,1800);
  if(negative.some(x=>x.test(text)))
    return {status:'ineligible',confidence:0.98,reason:'Official posting explicitly excludes hiring in Nigeria',excerpt,remoteScope};
  if(remoteScope==='restricted')
    return {status:'ineligible',confidence:0.95,reason:'Official posting explicitly restricts work to another country',excerpt,remoteScope};
  if(positive.some(x=>x.test(text)))
    return {status:'verified_eligible',confidence:0.9,reason:'Official job posting explicitly permits Nigeria-based candidates',excerpt,remoteScope};
  if(hasExplicitNigeriaLocation(location))
    return {status:'verified_eligible',confidence:0.9,
      reason:'Official job location explicitly includes Nigeria',excerpt,remoteScope};
  if(remoteScope==='worldwide'||/\b(?:worldwide|anywhere in the world|global remote)\b/i.test(text))
    return {status:'likely_eligible',confidence:0.45,reason:'Worldwide wording requires separate Nigeria hiring verification',excerpt,remoteScope};
  return {status:'unknown',confidence:0,reason:'Official posting does not establish Nigeria hiring eligibility',excerpt,remoteScope};
}
