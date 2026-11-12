import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOfficialPosting,postingLocation} from './eligibility.mjs';

test('job scoped Nigeria location is evidence, unlike generic worldwide remote',()=>{
  const job={content:'Build distributed systems. Remote work.',location:{name:'Lagos, Nigeria'}};
  const location=postingLocation(job,'greenhouse');
  const assessment=classifyOfficialPosting(job.content,location);
  assert.equal(location,'Lagos, Nigeria');
  assert.equal(assessment.status,'verified_eligible');
  assert.match(assessment.excerpt,/Official job location: Lagos, Nigeria/);
  assert.equal(classifyOfficialPosting('Remote anywhere in the world').status,'likely_eligible');
});
test('official location evidence is not inferred from a customer mention',()=>{
  assert.equal(classifyOfficialPosting('Our customers are in Nigeria','Remote').status,'unknown');
  assert.equal(classifyOfficialPosting('Nigeria is a customer region','London, UK').status,'unknown');
  assert.equal(classifyOfficialPosting('Software Engineer','Nigerian market').status,'unknown');
});
test('explicit exclusion takes precedence over the location field',()=>{
  assert.equal(classifyOfficialPosting('We cannot hire in Nigeria','Lagos, Nigeria').status,'ineligible');
});
test('lever and ashby location fields are provider scoped',()=>{
  assert.equal(postingLocation({categories:{location:'Nigeria'}},'lever'),'Nigeria');
  assert.equal(postingLocation({location:'Nigeria'},'ashby'),'Nigeria');
  assert.equal(postingLocation({description:'Nigeria'},'ashby'),'');
  assert.equal(postingLocation({location:{name:'Nigeria'}},'lever'),'');
});

test('explicit Nigeria entry in official semicolon-separated job locations is verified',()=>{
 const location='South Africa - CPT; Egypt; Kenya; Nigeria; South Africa - JHB';
 const outcome=classifyOfficialPosting('Build production software in a remote engineering team.',location);
 assert.equal(outcome.status,'verified_eligible');
 assert.match(outcome.reason,/Official job location/);
 assert.equal(classifyOfficialPosting('Remote work.','Egypt; Nigeria').status,'verified_eligible');
 assert.equal(classifyOfficialPosting('Remote work.','Lagos, Nigeria; Accra, Ghana').status,'verified_eligible');
});
test('continent-level or unstructured claims are never promoted to Nigeria eligibility',()=>{
 for(const location of ['Africa','Europe; Africa','London; Europe','Remote; worldwide','Nigeria excluded','Nigeria and Ghana','Somewhere in Nigeria?']) {
  assert.notEqual(classifyOfficialPosting('Remote role without location-specific hiring guarantees.',location).status,'verified_eligible');
 }
 assert.equal(classifyOfficialPosting('Our customers are in Nigeria','Egypt; Kenya').status,'unknown');
});
test('explicit Nigeria prohibition overrides structured eligible location entries',()=>{
 assert.equal(classifyOfficialPosting('We cannot hire in Nigeria','Egypt; Nigeria; Kenya').status,'ineligible');
});

test('Ashby verified location scope includes official secondaryLocations, not only primary',()=>{
 const posting={location:'South Africa - CPT',secondaryLocations:[
  {location:'Egypt'},{location:'Kenya'},{location:'Nigeria',address:{addressCountry:'Nigeria'}},
  {location:'South Africa - JHB'}
 ]};
 const location=postingLocation(posting,'ashby');
 assert.equal(location,'South Africa - CPT; Egypt; Kenya; Nigeria; South Africa - JHB');
 assert.equal(classifyOfficialPosting('Build distributed infrastructure.',location).status,'verified_eligible');
});
test('Ashby untrusted secondary data cannot assert Nigeria via marketing copy',()=>{
 const posting={location:'London',secondaryLocations:[
  {location:'Africa'}, {description:'Nigeria'}, {location:'Nigeria - excluded'}
 ]};
 const location=postingLocation(posting,'ashby');
 assert.equal(classifyOfficialPosting('Remote engineering role.',location).status,'unknown');
});
test('Ashby location ingestion stays bounded and ignores malformed secondaryLocations',()=>{
 const posting={location:'Paris',secondaryLocations:Array.from({length:80},(_,i)=>({
  location:'Location '+i
 }))};
 const location=postingLocation(posting,'ashby');
 assert(location.length<=300);
 assert(!location.includes('Location 79'));
 assert.equal(postingLocation({location:'Lagos',secondaryLocations:'Nigeria'},'ashby'),'Lagos');
});
