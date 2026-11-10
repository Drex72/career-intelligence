import test from 'node:test';
import assert from 'node:assert/strict';
import {boardEndpoint,normalizeBoard,validBoard} from './ats.mjs';
const now=Date.parse('2026-11-10T00:00:00Z');
test('fixed-host ATS endpoints reject arbitrary destinations',()=>{
  assert.equal(boardEndpoint('greenhouse','acme'), 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true');
  assert.equal(boardEndpoint('lever','acme'), 'https://api.lever.co/v0/postings/acme?mode=json');
  assert.equal(boardEndpoint('ashby','acme'), 'https://api.ashbyhq.com/posting-api/job-board/acme');
  assert.throws(()=>boardEndpoint('greenhouse','http://evil'));
  assert.throws(()=>boardEndpoint('custom','acme'));
  assert.equal(validBoard({provider:'ashby',slug:'my-company',company:'Company'}),true);
  assert.equal(validBoard({provider:'ashby',slug:'../user',company:'Company'}),false);
});
test('greenhouse jobs retain official listing URL and real published date',()=>{
  const rows=normalizeBoard({jobs:[{id:234,title:'Backend Engineer',absolute_url:'https://job-boards.greenhouse.io/acme/jobs/234',
    first_published:'2026-11-09T10:00:00Z',location:{name:'Remote'}}]},'greenhouse','acme','Acme',now);
  assert.equal(rows.length,1);assert.equal(rows[0].publishedAt,'2026-11-09T10:00:00.000Z');
});
test('lever and ashby preserve source-specific job fields',()=>{
  const lever=normalizeBoard([{id:'id-1',text:'Software Developer',hostedUrl:'https://jobs.lever.co/acme/id-1',createdAt:now}], 'lever','acme','Acme',now);
  const ashby=normalizeBoard({jobs:[{id:'dead-beef',title:'Platform Engineer',jobUrl:'https://jobs.ashbyhq.com/acme/dead-beef',isRemote:true}]},'ashby','acme','Acme',now);
  assert.equal(lever.length,1);assert.equal(ashby[0].remoteText,'Remote');assert.equal(ashby[0].publishedAt,null);
});
test('rejects external URL redirects, unrelated titles, stale/future jobs and malformed IDs',()=>{
  const rows=[
    {id:1,title:'Software Engineer',absolute_url:'https://evil.test/acme/jobs/1'},
    {id:2,title:'Sales Executive',absolute_url:'https://job-boards.greenhouse.io/acme/jobs/2'},
    {id:3,title:'Software Engineer',absolute_url:'https://job-boards.greenhouse.io/acme/jobs/3',first_published:'2026-01-01T00:00:00Z'},
    {id:4,title:'Software Engineer',absolute_url:'https://job-boards.greenhouse.io/acme/jobs/4?bad=1'},
    {id:'../etc',title:'Software Engineer',absolute_url:'https://job-boards.greenhouse.io/acme/jobs/5'}
  ];
  assert.deepEqual(normalizeBoard({jobs:rows},'greenhouse','acme','Acme',now),[]);
});
