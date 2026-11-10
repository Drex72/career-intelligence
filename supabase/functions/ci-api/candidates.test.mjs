import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateBoards} from './candidates.mjs';
const origin='https://remotive.com/remote-jobs/software-dev/backend-123';
test('discover official ATS links but preserve unverified candidate state externally',()=>{
  const text='<a href="https://jobs.ashbyhq.com/example-team/role">Apply</a> '+
    'https://jobs.lever.co/example-team/id-111 and https://job-boards.greenhouse.io/example-team/jobs/123';
  const xs=candidateBoards(text,'Example Team',origin);
  assert.deepEqual(xs.map(x=>x.provider),['ashby','lever','greenhouse']);
  assert(xs.every(x=>x.evidenceURL===origin));
});
test('reject spoofed hosts, mismatched sources and board-only paths',()=>{
  const src='https://jobs.lever.co.evil.com/acme/role https://jobs.ashbyhq.com/ '+
    'http://jobs.lever.co/acme/123 https://evil.com/jobs.lever.co/acme/123';
  assert.deepEqual(candidateBoards(src,'Acme',origin),[]);
  assert.deepEqual(candidateBoards('https://jobs.lever.co/acme/123','Acme','https://evil.test/feed'),[]);
});
test('deduplicates links per board and never invents employer verification',()=>{
  const xs=candidateBoards('https://jobs.lever.co/acme/123 https://jobs.lever.co/acme/124','Acme',origin);
  assert.equal(xs.length,1);
  assert.deepEqual(Object.keys(xs[0]).sort(),['company','evidenceURL','provider','slug']);
});
