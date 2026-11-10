import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHimalayas} from './himalayas.mjs';
const stamp=Date.parse('2026-11-10T12:00:00Z');
test('preserves Himalayas original application link and official source',()=>{
 const original='https://boards.greenhouse.io/example/jobs/123?gh_src=himalayas';
 const x=normalizeHimalayas({jobs:[{
   guid:'https://himalayas.app/companies/example/jobs/backend-engineer',
   companyName:'Example Software',title:'Backend Engineer',
   applicationLink:original,pubDate:Math.floor(stamp/1000),
   locationRestrictions:[{alpha2:'NG',name:'Nigeria'}]
 }]},stamp);
 assert.equal(x.length,1);
 assert.equal(x[0].applicationLink,original);
 assert.equal(x[0].guid,'https://himalayas.app/companies/example/jobs/backend-engineer');
 assert.match(x[0].locations,/NG/);
 assert.equal('eligibility' in x[0],false);
});
test('does not import stale, spoofed, or non-engineering listings',()=>{
 const base={companyName:'Example Software',title:'Software Engineer',
  guid:'https://himalayas.app/companies/example/jobs/software-engineer',
  applicationLink:'https://example.com/careers',pubDate:Math.floor(stamp/1000)};
 const jobs=[{...base,companyName:''}, {...base,guid:'https://himalayas.app.evil.test/companies/x/jobs/y'},
 {...base,pubDate:Math.floor(stamp/1000)-10*86400},
 {...base,applicationLink:'http://localhost/admin'},
 {...base,title:'Sales Executive'}];
 assert.equal(normalizeHimalayas({jobs},stamp).length,0);
});
test('unknown or missing publish date is not fabricated',()=>{
 const x=normalizeHimalayas({jobs:[{title:'Python Engineer',companyName:'Xyz',
  applicationLink:'https://example.com/job',guid:'https://himalayas.app/companies/xyz/jobs/python'}]},stamp);
 assert.equal(x.length,0);
 assert.throws(()=>normalizeHimalayas({},stamp));
});
