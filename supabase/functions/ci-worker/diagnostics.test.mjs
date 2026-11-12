import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceFetchFailure, sourceFailureReason, httpSourceFailure} from './diagnostics.mjs';
test('sanitized status categories never expose upstream text or credentials',()=>{
  assert.equal(sourceFailureReason(httpSourceFailure(429)),'rate_limited');
  assert.equal(sourceFailureReason(httpSourceFailure(404)),'board_not_found');
  assert.equal(sourceFailureReason(httpSourceFailure(410)),'board_not_found');
  assert.equal(sourceFailureReason(httpSourceFailure(503)),'upstream_server_error');
  assert.equal(sourceFailureReason(httpSourceFailure(403)),'upstream_http_error');
  assert.equal(sourceFailureReason(new SyntaxError('secret response body')),'invalid_json');
  assert.equal(sourceFailureReason(new SourceFetchFailure('response_too_large')),'response_too_large');
  assert.equal(sourceFailureReason(new Error('Authorization: token-123')),'unexpected_error');
  assert.equal(sourceFailureReason({name:'TimeoutError',message:'secret.example'}),'timeout');
});
