import test from 'node:test';
import assert from 'node:assert/strict';
import {countryName,countryOptions,parseKeywords,keywordError,targetSummary} from '../src/lib/targeting.mjs';

test('country names come from ISO codes and reject junk', () => {
  assert.equal(countryName('NG'), 'Nigeria');
  assert.equal(countryName('US'), 'United States');
  assert.equal(countryName('ng'), null);
  assert.equal(countryName(null), null);
  assert.ok(countryOptions().length > 200);
});

test('keywords are trimmed, collapsed and de-duplicated', () => {
  assert.deepEqual(parseKeywords(' Backend ,backend, platform  engineer,, '), ['Backend', 'platform engineer']);
  assert.deepEqual(parseKeywords(''), []);
});

test('keyword validation explains the problem', () => {
  assert.equal(keywordError(['python', 'go-lang']), null);
  assert.match(keywordError(Array.from({length: 9}, (_, i) => 'k' + i)), /at most 8/);
  assert.match(keywordError(['drop;table']), /drop;table/);
  assert.match(keywordError(['x']), /2–60/);
});

test('summary names countries and falls back to the default role filter', () => {
  assert.equal(targetSummary({applicant_country: 'NG', employer_country: null, role_keywords: []}),
    'Software engineering roles open to applicants in Nigeria.');
  assert.equal(targetSummary({applicant_country: 'GH', employer_country: 'US', role_keywords: ['backend']}),
    'Backend roles open to applicants in Ghana at employers based in United States.');
  assert.equal(targetSummary(null), 'No search target saved yet.');
});
