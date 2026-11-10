import test from 'node:test';
import assert from 'node:assert/strict';
import {safePreview} from './telemetry.mjs';

test('flow telemetry only exposes allowlisted scalar fields',()=>{
 const input={
  provider:'greenhouse',board:'canonicaljobs',title:'Software Engineer',score:92,
  job_id:'f59015fd-927f-4cee-a023-0d9784e19171',
  secret:'SUPABASE_SERVICE_ROLE_KEY=bad',raw_description:'private',
  approved_note_body:'My confidential salary',authorization:'Bearer secret',
  nested:{password:'nope'},tokens:['x','y']
 };
 assert.deepEqual(safePreview(input),{
  provider:'greenhouse',board:'canonicaljobs',title:'Software Engineer',score:92,
  job_id:'f59015fd-927f-4cee-a023-0d9784e19171'
 });
});
test('null, arrays, complex object fields are never copied',()=>{
 assert.deepEqual(safePreview(null),{});
 assert.deepEqual(safePreview([]),{});
 assert.deepEqual(safePreview({title:['private'],status:{foo:'bar'},count:'5',saved:true}),{saved:true});
});
test('untrusted text is bounded and newline-free',()=>{
 assert.equal(safePreview({title:'a'.repeat(350)}).title.length,180);
 assert.equal(safePreview({title:'engineer\nsecret'}).title,'engineer secret');
});
