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
