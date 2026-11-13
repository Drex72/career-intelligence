import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyOfficialPosting} from './eligibility.mjs';

test('eligibility worker persists independent official remote scope after successful review',()=>{
 const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
 const saved=source.indexOf("if(wrote.error||!wrote.data){report.failures++;}");
 const persist=source.indexOf("db.rpc('ci_record_ats_remote_scope'");
 const counted=source.indexOf("if(d.status==='verified_eligible')report.verified_eligible++");
 assert(saved>=0 && persist>saved && counted>persist);
 assert.match(source.slice(saved,counted),/p_scope:d\.remoteScope/);
 assert.match(source.slice(saved,counted),/scopeWritten\.error\|\|scopeWritten\.data!==true/);
});
test('worldwide language alone remains unverified for Nigeria even when scope is persisted',()=>{
 const worldwide=classifyOfficialPosting('Work from anywhere in the world building APIs.','Remote - Global');
 assert.equal(worldwide.status,'likely_eligible');
 assert.equal(worldwide.remoteScope,'worldwide');
 const restricted=classifyOfficialPosting('You must be based in the United States.','Remote - Global');
 assert.equal(restricted.status,'ineligible');
 assert.equal(restricted.remoteScope,'restricted');
});
