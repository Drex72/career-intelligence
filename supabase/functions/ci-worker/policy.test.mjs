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
