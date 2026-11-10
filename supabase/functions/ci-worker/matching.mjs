/** Auditable lexical matching: only the overlap actually present in approved notes. */
export const TRACKED_SKILLS=[
  'python','typescript','javascript','node.js','react','next.js','rust','golang',
  'java','c++','docker','kubernetes','postgresql','sql','redis','linux',
  'aws','gcp','azure','supabase','pytorch','tensorflow','llm','langchain',
  'fastapi','graphql','backend','frontend','infrastructure','distributed systems',
  'machine learning','security','platform engineering','testing','api'
];
function appears(text,term){
  const escaped=term.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}])'+escaped+'(?=$|[^\\p{L}\\p{N}])','iu').test(text);
}
export function scoreApprovedMatch(jobTitle,remoteText,knowledgeBodies){
  const jobText=[jobTitle,remoteText].filter(x=>typeof x==='string').join(' ').slice(0,3000);
  const approved=(knowledgeBodies||[]).filter(x=>typeof x==='string').join('\n').slice(0,30000);
  if(!approved.trim())return null;
  const mentioned=TRACKED_SKILLS.filter(skill=>appears(jobText,skill));
  const matched=mentioned.filter(skill=>appears(approved,skill));
  const gaps=mentioned.filter(skill=>!appears(approved,skill));
  // No job-side requirements means no evidence to infer a fit score.
  const score=mentioned.length?Math.round(100*matched.length/mentioned.length):0;
  return {score,matched,gaps,method:'keyword-overlap-v1'};
}
export async function approvedRevision(documents){
  const entries=(documents||[]).map(d=>String(d.path)+':'+String(d.content_sha)).sort().join('\n');
  const bytes=new TextEncoder().encode(entries);
  const result=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
}
