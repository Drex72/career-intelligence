import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBackend} from '../src/lib/backend-base.mjs';
const supabase='https://manqpbwiwmzqxgldhbdt.supabase.co';
const edge=supabase+'/functions/v1/ci-api';
test('the configured Supabase Edge function path is allowed',()=>{
  assert.equal(resolveBackend(edge,supabase,'production'),edge);
});
test('wrong hosts, credentials, query strings and arbitrary paths are rejected',()=>{
  for (const url of [
    'https://attacker.example/functions/v1/ci-api',
    'https://manqpbwiwmzqxgldhbdt.supabase.co.attacker.example/functions/v1/ci-api',
    edge+'/other',
    edge+'?target=evil',
    'https://someone:secret@manqpbwiwmzqxgldhbdt.supabase.co/functions/v1/ci-api',
    'file:///etc/passwd'
  ]) assert.equal(resolveBackend(url,supabase,'production'),null,url);
});
test('local Python API is permitted only in development',()=>{
  assert.equal(resolveBackend('http://localhost:8000',supabase,'development'),'http://localhost:8000');
  assert.equal(resolveBackend('http://localhost:8000',supabase,'production'),null);
});
