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
export function classifyOfficialPosting(raw) {
  const text=plainPosting(raw);
  if(!text)return {status:'unknown',confidence:0,reason:'No official description text',excerpt:''};
  const excerpt=text.slice(0,2000);
  if(negative.some(x=>x.test(text)))
    return {status:'ineligible',confidence:0.98,reason:'Official posting explicitly excludes hiring in Nigeria',excerpt};
  if(positive.some(x=>x.test(text)))
    return {status:'verified_eligible',confidence:0.9,reason:'Official job posting explicitly permits Nigeria-based candidates',excerpt};
  if(/\b(?:worldwide|anywhere in the world|global remote)\b/i.test(text))
    return {status:'likely_eligible',confidence:0.45,reason:'Worldwide wording requires separate Nigeria hiring verification',excerpt};
  return {status:'unknown',confidence:0,reason:'Official posting does not establish Nigeria hiring eligibility',excerpt};
}
