import test from 'node:test';
import assert from 'node:assert/strict';
import {safePath} from '../src/lib/ci-routes.mjs';

test('owner-triggered public discovery is forwarded as POST', () => {
  assert.equal(safePath(['discover'], 'POST'), 'discover');
  assert.equal(safePath(['discover'], 'GET'), null);
});
test('read-only resources and calendar batch are allowed', () => {
  assert.equal(safePath(['jobs'],'GET'),'jobs');
  assert.equal(safePath(['batches','2026-11-10'],'GET'),'batches/2026-11-10');
});
test('outbound send endpoints and arbitrary path segments remain blocked', () => {
  for (const path of [['outreach','send'],['discover','any'],['../metrics'],['../../secrets']]) {
    assert.equal(safePath(path,'POST'),null);
  }
});

test('job evidence route is read-only and requires UUID-shaped ID',()=>{
 const id='f59015fd-927f-4cee-a023-0d9784e19171';
 assert.equal(safePath(['jobs',id,'evidence'],'GET'),`jobs/${id}/evidence`);
 assert.equal(safePath(['jobs',id,'evidence'],'POST'),null);
 assert.equal(safePath(['jobs','not-an-id','evidence'],'GET'),null);
});

test('daily batch generation requires POST',()=>{
 assert.equal(safePath(['batches','generate'],'POST'),'batches/generate');
 assert.equal(safePath(['batches','generate'],'GET'),null);
});

test('ATS registration and scanning are POST-only and queues are read-only',()=>{
  assert.equal(safePath(['sources'],'GET'),'sources');
  assert.equal(safePath(['sources'],'POST'),'sources');
  assert.equal(safePath(['sources','scan'],'POST'),'sources/scan');
  assert.equal(safePath(['sources','scan'],'GET'),null);
  assert.equal(safePath(['eligibility-queue'],'GET'),'eligibility-queue');
  assert.equal(safePath(['eligibility-queue'],'POST'),null);
});
