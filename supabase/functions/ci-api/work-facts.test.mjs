import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWorkFacts} from './work-facts.mjs';
test('explicit role-scoped work arrangements only',()=>{
  assert.deepEqual(classifyWorkFacts('This position is fully remote. Visa sponsorship is provided.'),{workMode:'remote',sponsorship:'confirmed'});
  assert.equal(classifyWorkFacts('Workplace type: Hybrid').workMode,'hybrid');
  assert.equal(classifyWorkFacts('Work arrangement: On-site').workMode,'onsite');
  assert.equal(classifyWorkFacts('We operate globally with remote colleagues').workMode,'unknown');
  assert.equal(classifyWorkFacts('Workplace type: Remote; Workplace type: Hybrid').workMode,'unknown');
});
test('visa cannot be inferred from remote claims or the word visa alone',()=>{
  assert.equal(classifyWorkFacts('Remote worldwide. Visa support might be possible.').sponsorship,'unknown');
  assert.equal(classifyWorkFacts('Applicants located in Nigeria are eligible.').sponsorship,'unknown');
  assert.equal(classifyWorkFacts('We do not offer visa sponsorship.').sponsorship,'not_offered');
  assert.equal(classifyWorkFacts('Visa sponsorship is available, but no visa sponsorship for this role.').sponsorship,'not_offered');
});
test('facts are bounded to evidence excerpt stored in database',()=>{
  const text='x'.repeat(2000)+' Visa sponsorship is offered.';
  assert.equal(classifyWorkFacts(text).sponsorship,'unknown');
});
