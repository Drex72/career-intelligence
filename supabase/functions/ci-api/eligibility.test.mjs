import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOfficialPosting,findOfficialJob,plainPosting,postingDescription} from './eligibility.mjs';
test('explicit Nigeria permission is verified only when job-scoped text is clear',()=>{
  assert.equal(classifyOfficialPosting('We hire in Nigeria and support remote engineers').status,'verified_eligible');
  assert.equal(classifyOfficialPosting('Candidates based in Nigeria are eligible').status,'verified_eligible');
  assert.equal(classifyOfficialPosting('Eligible countries: Ghana, Nigeria, Kenya').status,'verified_eligible');
});
test('explicit Nigeria exclusions override positive wording',()=>{
  assert.equal(classifyOfficialPosting('We hire in Nigeria, but currently cannot hire in Nigeria.').status,'ineligible');
  assert.equal(classifyOfficialPosting('Nigeria is not eligible').status,'ineligible');
  assert.equal(classifyOfficialPosting('Candidates based in Nigeria are not eligible').status,'ineligible');
});
test('remote anywhere never automatically proves legal eligibility',()=>{
  assert.equal(classifyOfficialPosting('Work remotely from anywhere in the world!').status,'likely_eligible');
  assert.equal(classifyOfficialPosting('Remote worldwide. We are a global team.').status,'likely_eligible');
  assert.equal(classifyOfficialPosting('Nigeria mentioned as a customer region. Remote software engineer.').status,'unknown');
  assert.equal(classifyOfficialPosting('US candidates only. Remote').status,'unknown');
});
test('official posting is tied to matching provider job id',()=>{
  const payload={jobs:[{id:'a-1',descriptionHtml:'<p>We hire in Nigeria</p>'},{id:'a-2',title:'Different job'}]};
  assert.equal(postingDescription(findOfficialJob(payload,'ashby','a-1'),'ashby'),'We hire in Nigeria');
  assert.equal(findOfficialJob(payload,'ashby','missing'),null);
  assert.equal(findOfficialJob(payload,'ashby','../unsafe'),null);
});
test('untrusted HTML and markup are stripped before recording evidence',()=>{
  assert.equal(plainPosting('<script>bad()</script><p>Engineers &amp; researchers</p>'),'Engineers & researchers');
});
