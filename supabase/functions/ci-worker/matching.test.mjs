import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreApprovedMatch,approvedRevision} from './matching.mjs';

test('matching never invents knowledge that is absent from approved notes',()=>{
 const a=scoreApprovedMatch('Python Backend Engineer','Docker and Kubernetes required',
  ['I have Python backend engineering experience and Docker']);
 assert.deepEqual(a.matched,['python','docker','backend']);
 assert.deepEqual(a.gaps,['kubernetes']);
 assert.equal(a.score,75);
});
test('missing knowledge never creates a match; no listed skill yields zero',()=>{
 assert.equal(scoreApprovedMatch('Python Engineer','',''),null);
 const a=scoreApprovedMatch('Graduate Associate','Remote only',['Python']);
 assert.equal(a.score,0);
 assert.deepEqual(a.matched,[]);
});
test('a matching-safe revision is stable across document ordering but changes with source hash',async()=>{
 const a=[{path:'01/work.md',content_sha:'abc'},{path:'02/projects.md',content_sha:'xyz'}];
 assert.equal(await approvedRevision(a),await approvedRevision([...a].reverse()));
 assert.notEqual(await approvedRevision(a),await approvedRevision([{path:'01/work.md',content_sha:'changed'}]));
});
test('word boundaries reject substring false positives',()=>{
 const a=scoreApprovedMatch('Java Engineer','Java required',['I mostly use JavaScript']);
 assert.equal(a.score,0);
 assert.deepEqual(a.gaps,['java']);
});
