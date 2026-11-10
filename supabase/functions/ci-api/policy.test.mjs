import test from 'node:test';
import assert from 'node:assert/strict';
import {route,isUuid,validApplication,validDraft,validReply,classifyReply,roleRestricted} from './policy.mjs';
const a='00000000-0000-4000-8000-000000000001';
test('routes only enumerated paths',()=>{
 assert.deepEqual(route('https://localhost/functions/v1/ci-api/api/ci/jobs','GET'),{type:'read',path:'jobs'});
 assert.deepEqual(route('https://localhost/functions/v1/ci-api/api/ci/batches/2026-11-10','GET'),{type:'batch',day:'2026-11-10'});
 assert.deepEqual(route('https://localhost/api/ci/discover','POST'),{type:'discover'});
 assert.equal(route('https://localhost/api/ci/discover','GET'),null);
 assert.equal(route('https://localhost/api/ci/outreach/send','POST'),null);
 assert.equal(route('https://localhost/api/ci/../secret','GET'),null);
});
test('validates application body',()=>{
 assert.equal(isUuid(a),true);
 assert.equal(validApplication({job_id:a,status:'applied',notes:'Applied on official site'}),true);
 assert.equal(validApplication({job_id:a,status:'sent'}),false);
 assert.equal(validApplication({job_id:'foo',status:'applied'}),false);
});
test('draft and reply strictly bounded',()=>{
 assert.equal(validDraft({job_id:a,contact_id:a}),true);
 assert.equal(validReply({job_id:a,contact_id:a,body:'Thanks',source_url:'https://example.org'}),true);
 assert.equal(validReply({job_id:a,contact_id:a,body:'Thanks',source_url:'javascript:alert(1)'}),false);
});
test('conversations are conservative',()=>{
 assert.equal(classifyReply('Unfortunately we are not moving forward'),'rejected');
 assert.equal(classifyReply('Please do not contact me'),'opt_out');
 assert.equal(classifyReply('We need US-only applicants'),'reply');
 assert.equal(roleRestricted('Must be based in the United States'),true);
});

test('evidence access is GET-only and validates job UUID',()=>{
 const valid='f59015fd-927f-4cee-a023-0d9784e19171';
 assert.deepEqual(route(`https://localhost/functions/v1/ci-api/api/ci/jobs/${valid}/evidence`,'GET'),{type:'evidence',jobId:valid});
 assert.equal(route(`https://localhost/functions/v1/ci-api/api/ci/jobs/${valid}/evidence`,'POST'),null);
 assert.equal(route('https://localhost/functions/v1/ci-api/api/ci/jobs/invalid/evidence','GET'),null);
});

test('daily batch generation is a separate owner-only POST route',()=>{
 assert.deepEqual(route('https://localhost/functions/v1/ci-api/api/ci/batches/generate','POST'),{type:'generateBatch'});
 assert.equal(route('https://localhost/functions/v1/ci-api/api/ci/batches/generate','GET'),null);
});

test('ATS source operations require owner POST, while review queue is read-only',()=>{
  assert.deepEqual(route('https://localhost/api/ci/sources','POST'),{type:'registerSource'});
  assert.deepEqual(route('https://localhost/api/ci/sources/scan','POST'),{type:'scanSource'});
  assert.deepEqual(route('https://localhost/api/ci/sources','GET'),{type:'read',path:'sources'});
  assert.deepEqual(route('https://localhost/api/ci/eligibility-queue','GET'),{type:'read',path:'eligibility-queue'});
  assert.equal(route('https://localhost/api/ci/sources/scan','GET'),null);
});
