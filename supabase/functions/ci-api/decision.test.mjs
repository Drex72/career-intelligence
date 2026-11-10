import test from 'node:test';
import assert from 'node:assert/strict';
import {currentEligibility,visibleMatchScore,currentApprovedRevision} from './decision.mjs';
const now=Date.parse('2026-11-10T15:00:00Z');
test('expired positive hiring assessments never appear verified',()=>{
 const expired=currentEligibility({status:'verified_eligible',expires_at:'2026-11-09T15:00:00Z'},true,now);
 assert.equal(expired.status,'unknown');
 assert.equal(expired.expired,true);
 assert.equal(visibleMatchScore({score:88,knowledge_revision:'abcd'},expired,'completed','abcd'),0);
});
test('fresh positive hiring requires actual evidence',()=>{
 assert.equal(currentEligibility({status:'verified_eligible',expires_at:null},false,now).status,'unknown');
 assert.equal(currentEligibility({status:'verified_eligible',expires_at:null},true,now).status,'verified_eligible');
});
test('stale or incomplete matching task hides old scores',()=>{
 const eligible=currentEligibility({status:'verified_eligible',expires_at:'2026-11-11T15:00:00Z'},true,now);
 assert.equal(visibleMatchScore({score:88,knowledge_revision:'abcd'},eligible,'pending','abcd'),0);
 assert.equal(visibleMatchScore({score:88,knowledge_revision:'abcd'},eligible,'awaiting_approval','abcd'),0);
 assert.equal(visibleMatchScore({score:88,knowledge_revision:'abcd'},eligible,'completed','abcd'),88);
});
test('expired exclusions and likely claims are conservatively shown',()=>{
 assert.equal(currentEligibility({status:'ineligible',expires_at:'2026-11-08T10:00:00Z'},true,now).status,'unknown');
 assert.equal(currentEligibility({status:'likely_eligible',expires_at:null},true,now).status,'likely_eligible');
});

test('deleted or changed knowledge invalidates a completed fit score',async()=>{
 const docs=[{path:'work.md',content_sha:'abc'}];
 const rev=await currentApprovedRevision(docs);
 const eligible=currentEligibility({status:'verified_eligible',expires_at:null},true,now);
 assert.equal(visibleMatchScore({score:88,knowledge_revision:rev},eligible,'completed',rev),88);
 assert.equal(visibleMatchScore({score:88,knowledge_revision:rev},eligible,'completed',null),0);
 assert.equal(visibleMatchScore({score:88,knowledge_revision:rev},eligible,'completed',
   await currentApprovedRevision([{path:'work.md',content_sha:'changed'}])),0);
 assert.equal(await currentApprovedRevision([]),null);
});
