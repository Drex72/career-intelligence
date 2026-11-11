import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBoard,normalizeBoard} from './ats.mjs';
import {analyzeHimalayas,normalizeHimalayas} from './himalayas.mjs';
import {safePreview} from './telemetry.mjs';

const now=Date.parse('2026-11-11T10:00:00Z');
const validGH={id:123,title:'Backend Software Engineer',
 absolute_url:'https://job-boards.greenhouse.io/example/jobs/123',
 first_published:'2026-11-10T09:00:00Z',location:{name:'Lagos, Nigeria'}};

test('ATS discovery records every initial screening decision without changing accepted jobs',()=>{
 const payload={jobs:[
  validGH,
  {...validGH,id:124,title:'Sales Manager',absolute_url:'https://job-boards.greenhouse.io/example/jobs/124'},
  {...validGH,id:125,absolute_url:'https://malicious.example/jobs/125'},
  {...validGH,id:126,absolute_url:'https://job-boards.greenhouse.io/example/jobs/126',
   first_published:'2026-07-01T00:00:00Z'}
 ]};
 const out=analyzeBoard(payload,'greenhouse','example','Example Ltd',now);
 assert.equal(out.scanned,4);
 assert.equal(out.jobs.length,1);
 assert.deepEqual(out.excluded,{role:1,source:1,stale:1});
 assert.equal(out.scanned,out.jobs.length+Object.values(out.excluded).reduce((a,b)=>a+b,0));
 assert.deepEqual(normalizeBoard(payload,'greenhouse','example','Example Ltd',now),out.jobs);
});

test('Himalayas screening distinguishes title, source and age rejections',()=>{
 const base={title:'Backend Engineer',companyName:'Example Ltd',
  guid:'https://himalayas.app/companies/example/jobs/backend-engineer',
  applicationLink:'https://example.com/apply',pubDate:Math.floor(now/1000)};
 const payload={jobs:[
  base,
  {...base,title:'Account Executive'},
  {...base,guid:'https://himalayas.app.evil.example/companies/example/jobs/backend-engineer'},
  {...base,pubDate:Math.floor(now/1000)-10*86400}
 ]};
 const out=analyzeHimalayas(payload,now);
 assert.equal(out.scanned,4);
 assert.equal(out.jobs.length,1);
 assert.deepEqual(out.excluded,{role:1,source:1,stale:1});
 assert.deepEqual(normalizeHimalayas(payload,now),out.jobs);
});

test('source-level measurement previews expose numeric facts but not raw descriptions',()=>{
 const output=safePreview({
  received:40,accepted:20,ingested:17,rejected:20,
  rejected_role:9,rejected_source:6,rejected_stale:5,not_selected:3,
  description:'Secret pasted company text',private_notes:'Never include'
 });
 assert.deepEqual(output,{
  received:40,accepted:20,ingested:17,rejected:20,
  rejected_role:9,rejected_source:6,rejected_stale:5,not_selected:3
 });
 assert.equal(output.rejected,output.rejected_role+output.rejected_source+output.rejected_stale);
});
