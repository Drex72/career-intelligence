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
