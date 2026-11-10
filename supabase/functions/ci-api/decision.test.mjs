import test from 'node:test';
import assert from 'node:assert/strict';
import {currentEligibility,visibleMatchScore} from './decision.mjs';
const now=Date.parse('2026-11-10T15:00:00Z');
test('expired positive hiring assessments never appear verified',()=>{
 const expired=currentEligibility({status:'verified_eligible',expires_at:'2026-11-09T15:00:00Z'},true,now);
 assert.equal(expired.status,'unknown');
 assert.equal(expired.expired,true);
 assert.equal(visibleMatchScore({score:88},expired,'completed'),0);
});
test('fresh positive hiring requires actual evidence',()=>{
 assert.equal(currentEligibility({status:'verified_eligible',expires_at:null},false,now).status,'unknown');
 assert.equal(currentEligibility({status:'verified_eligible',expires_at:null},true,now).status,'verified_eligible');
});
test('stale or incomplete matching task hides old scores',()=>{
 const eligible=currentEligibility({status:'verified_eligible',expires_at:'2026-11-11T15:00:00Z'},true,now);
 assert.equal(visibleMatchScore({score:88},eligible,'pending'),0);
 assert.equal(visibleMatchScore({score:88},eligible,'awaiting_approval'),0);
 assert.equal(visibleMatchScore({score:88},eligible,'completed'),88);
});
test('expired exclusions and likely claims are conservatively shown',()=>{
 assert.equal(currentEligibility({status:'ineligible',expires_at:'2026-11-08T10:00:00Z'},true,now).status,'unknown');
 assert.equal(currentEligibility({status:'likely_eligible',expires_at:null},true,now).status,'likely_eligible');
});
