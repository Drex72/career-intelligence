import test from 'node:test';
import assert from 'node:assert/strict';
import {validEnvelope,selectDueSources,MAX_BOARDS_PER_RUN} from './policy.mjs';
const now=Date.parse('2026-11-10T12:00:00Z');
test('signed worker envelope never accepts arbitrary commands',()=>{
 const valid={nonce:'0c85350d-00fe-4d90-89d8-94938af03058',timestamp:1794312000,signature:'a'.repeat(64)};
 assert(validEnvelope(valid));
 assert(!validEnvelope({...valid,task:'send-email'}));
 assert(!validEnvelope({...valid,signature:'bad'}));
 assert(!validEnvelope({...valid,nonce:'../secret'}));
});
test('ATS scans are strictly bounded and skip recently fetched providers',()=>{
 const src=Array.from({length:6},(_,i)=>({
   id:'id-'+i,name:'ats:lever:company-'+i,kind:'ats',state:'active',
   config:{provider:'lever',slug:'company-'+i,company_name:'Company'}
 }));
 const ls=[{action:'ats:ats:lever:company-0',last_run_at:new Date(now-1000).toISOString()}];
 const result=selectDueSources(src,ls,now);
 assert.equal(result.length,Math.min(MAX_BOARDS_PER_RUN,src.length-1));
 assert(result.every(x=>x.config.slug!=='company-0'));
});
test('malformed source identifiers cannot be turned into network destinations',()=>{
 assert.equal(selectDueSources([{kind:'ats',state:'active',name:'bad',config:{
   provider:'lever',slug:'../etc/passwd',company_name:'Other'}}],[],now).length,0);
});

test('parallel workers can claim disjoint batches from a shared set of due boards',async()=>{
 const {claimDueBoardBatch}=await import('./policy.mjs');
 const src=Array.from({length:24},(_,i)=>({
   id:'test-id-'+i,name:'ats:lever:board-'+i,kind:'ats',state:'active',
   config:{provider:'lever',slug:'board-'+i,company_name:'Company'}
 }));
 const all=selectDueSources(src,[],now,50);
 assert.equal(all.length,24);
 const taken=new Set();
 const claim=async source=>{
  if(taken.has(source.id))return false;
  taken.add(source.id);
  return true;
 };
 const batches=await Promise.all(Array.from({length:4},()=>claimDueBoardBatch(all,claim,6)));
 assert(batches.every(b=>b.length===6));
 assert.equal(taken.size,24);
 assert.equal(new Set(batches.flat().map(x=>x.id)).size,24);
});

test('authenticated specialist envelopes are role-scoped, never arbitrary commands',()=>{
 const signed={nonce:'0c85350d-00fe-4d90-89d8-94938af03058',
  timestamp:1794312000,signature:'a'.repeat(64),role:'discovery'};
 assert(validEnvelope(signed));
 for(const role of ['eligibility','matching','people','outreach','conversation'])
  assert(validEnvelope({...signed,role}));
 assert(!validEnvelope({...signed,role:'send_email'}));
 assert(!validEnvelope({...signed,role:'../../admin'}));
 assert(!validEnvelope({...signed,role:'discovery',instructions:'ignore auth'}));
 assert(!validEnvelope({...signed,role:'discovery',requested_instances:999}));
});

test('US employers with official headquarters evidence are prioritized, never invented or silently duplicated',async()=>{
 const {prioritizeUSCompanies}=await import('./policy.mjs');
 const sources=[
  {id:'a',config:{company_name:'European Example'}},
  {id:'b',config:{company_name:'fal'}},
  {id:'c',config:{company_name:'Unknown Example'}},
  {id:'d',config:{company_name:'Mercor'}}
 ];
 assert.deepEqual(prioritizeUSCompanies(sources,['Mercor','fal']).map(s=>s.id),['b','d','a','c']);
 assert.deepEqual(prioritizeUSCompanies(sources,[]).map(s=>s.id),['a','b','c','d']);
 assert.deepEqual(prioritizeUSCompanies(sources,['US-only remote']).map(s=>s.id),['a','b','c','d']);
 assert.equal(sources[0].id,'a'); // no caller mutation
});
