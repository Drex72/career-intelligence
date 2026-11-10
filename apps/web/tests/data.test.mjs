import test from 'node:test';
import assert from 'node:assert/strict';
import { safeDateLabel, formatStatus, rankedOpportunities } from '../src/lib/data.mjs';

test('safeDateLabel handles missing and malformed publication dates', () => {
  assert.equal(safeDateLabel(null), 'Not provided');
  assert.equal(safeDateLabel('not-a-date'), 'Not provided');
  assert.equal(safeDateLabel('2026-11-10T00:00:00Z'), '10 Nov 2026');
});

test('formatStatus never invents verified eligibility', () => {
  assert.equal(formatStatus('verified_eligible'), 'Verified eligible');
  assert.equal(formatStatus('unknown'), 'Unknown');
});

test('rankedOpportunities keeps delivered ranking stable', () => {
  assert.deepEqual(rankedOpportunities([{rank:3,job_id:'three'},{rank:1,job_id:'one'}]).map(x=>x.job_id), ['one','three']);
});
