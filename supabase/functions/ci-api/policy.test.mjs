import test from 'node:test';
import assert from 'node:assert/strict';
import {route,isUuid,validApplication,validDraft,validReply,classifyReply,roleRestricted} from './policy.mjs';
const a='00000000-0000-4000-8000-000000000001';
test('routes only enumerated paths',()=>{
 assert.deepEqual(route('https://localhost/functions/v1/ci-api/api/ci/jobs','GET'),{type:'read',path:'jobs'});
 assert.deepEqual(route('https://localhost/functions/v1/ci-api/api/ci/batches/2026-11-10','GET'),{type:'batch',day:'2026-11-10'});
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
