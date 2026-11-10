import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateBoards} from './candidates.mjs';

const himalayas='https://himalayas.app/companies/example-software/jobs/backend-engineer';
test('Himalayas official ATS apply links are candidate evidence, not approved boards',()=>{
  const links='https://jobs.ashbyhq.com/example/role-1 https://jobs.lever.co/example/role-2';
  const result=candidateBoards(links,'Example Software',himalayas);
  assert.deepEqual(result.map(x=>x.provider),['ashby','lever']);
  assert(result.every(x=>x.evidenceURL===himalayas));
  assert(result.every(x=>!('verified' in x)));
});
test('reject spoofed Himalayas source URLs and unsafe ATS hosts',()=>{
  const link='https://jobs.lever.co/example/123';
  for(const source of [
    'https://himalayas.app.evil.test/companies/example/jobs/backend',
    'https://himalayas.app/companies/example/jobs/backend/other',
    'https://himalayas.app/companies/example/jobs/backend?redirect=evil',
    'https://untrusted.example/jobs/backend',
    'http://himalayas.app/companies/example/jobs/backend',
  ])assert.deepEqual(candidateBoards(link,'Example Software',source),[]);
  assert.deepEqual(candidateBoards('https://jobs.lever.co.evil.test/example/123','Example Software',himalayas),[]);
});
