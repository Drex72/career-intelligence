import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHimalayas,himalayasLocationRule,countryCode,himalayasSearchURL,roleMatches} from './himalayas.mjs';

const now=Date.parse('2026-11-18T12:00:00Z');
const job=(over={})=>({title:'Backend Engineer',companyName:'Example',
  guid:'https://himalayas.app/companies/example/jobs/backend-engineer',
  applicationLink:'https://himalayas.app/companies/example/jobs/backend-engineer/apply',
  pubDate:Math.floor(now/1000)-3600,locationRestrictions:[],...over});

test('empty restriction list is a worldwide rule',()=>{
  assert.deepEqual(himalayasLocationRule([]),{worldwide:true,countries:[],unrecognised:0});
});
test('plain ISO names and alpha2 objects both map to codes',()=>{
  const rule=himalayasLocationRule(['Nigeria','Ghana',"Côte d'Ivoire",'Saint Kitts and Nevis',{alpha2:'ke',name:'Kenya'}]);
  assert.deepEqual(rule.countries,['CI','GH','KE','KN','NG']);
  assert.equal(countryCode('Congo, The Democratic Republic of the'),'CD');
  assert.equal(countryCode('Virgin Islands, U.S.'),'VI');
});
test('unrecognised-only lists produce no rule, never a guess',()=>{
  assert.equal(himalayasLocationRule(['Atlantis']),null);
  assert.equal(himalayasLocationRule('Nigeria'),null);
  const partial=himalayasLocationRule(['Atlantis','Nigeria']);
  assert.deepEqual(partial.countries,['NG']);assert.equal(partial.unrecognised,1);
});
test('the old object-only parser bug is fixed: name strings carry the rule through',()=>{
  const out=analyzeHimalayas({jobs:[job({locationRestrictions:['Nigeria','Kenya']})]},now);
  assert.deepEqual(out.jobs[0].rule.countries,['KE','NG']);
  assert.match(out.jobs[0].locations,/per Himalayas/);
});
test('owner keywords replace the engineering default role filter',()=>{
  assert.equal(roleMatches('Product Designer',['designer']),true);
  assert.equal(roleMatches('Product Designer',[]),false);
  assert.equal(roleMatches('Senior Backend Engineer',['backend']),true);
  const out=analyzeHimalayas({jobs:[job({title:'Product Designer'})]},now,['designer']);
  assert.equal(out.jobs.length,1);
});
test('search URL only accepts validated settings',()=>{
  assert.equal(himalayasSearchURL('NG','software engineer',2),
    'https://himalayas.app/jobs/api/search?country=NG&sort=recent&page=2&q=software+engineer');
  assert.equal(himalayasSearchURL('GH','',1),'https://himalayas.app/jobs/api/search?country=GH&sort=recent&page=1');
  for(const bad of [['ng','x',1],['NG','a&b=c',1],['NG','ok',0],['NG','ok',1001],['NGA','ok',1]])
    assert.throws(()=>himalayasSearchURL(...bad));
});
