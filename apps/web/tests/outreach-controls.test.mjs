import test from 'node:test';
import assert from 'node:assert/strict';
import {availableOutreachActions} from '../src/lib/outreach-controls.mjs';

test('only untouched drafts offer manual approval',()=>{
  assert.deepEqual(availableOutreachActions({status:'draft'},null,null),{approve:true,queue:false,revoke:false});
  assert.equal(availableOutreachActions({status:'cancelled'},null,null).approve,false);
});
test('approved drafts can queue once but never automatically send',()=>{
  const approve={mode:'manual'};
  assert.deepEqual(availableOutreachActions({status:'approved'},approve,null),{approve:false,queue:true,revoke:true});
  assert.deepEqual(availableOutreachActions({status:'approved'},approve,{status:'pending'}),{approve:false,queue:false,revoke:true});
});
test('revocation preserves uncertain provider-state warnings',()=>{
  assert.deepEqual(availableOutreachActions({status:'approved'},null,{status:'sending_unknown'}),{approve:false,queue:false,revoke:false});
  assert.equal(availableOutreachActions({status:'approved'},null,{status:'cancelled'}).queue,false);
});
