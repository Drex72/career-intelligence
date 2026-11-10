import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibilityGroup,filterOpportunities} from '../src/lib/opportunity-filters.mjs';

const jobs=[
 {id:'a',company_name:'Northstar',title:'Software Engineer',eligibility:'verified_eligible'},
 {id:'b',company_name:'Acme',title:'Backend Engineer',eligibility:'likely_eligible'},
 {id:'c',company_name:'Coastline',title:'Platform Engineer',eligibility:'ineligible'},
 {id:'d',company_name:'Meridian',title:'Frontend Engineer',eligibility:null},
 {id:'e',company_name:'Orion',title:'Research Engineer',eligibility:'pending'},
 {id:'f',company_name:'Lumen',title:'Security Engineer',eligibility:'unknown'},
];

test('unknown and pending jobs must never count as verified eligible',()=>{
 for(const status of [null,undefined,'unknown','pending','unverified','other']){
  assert.equal(eligibilityGroup(status),'unverified');
 }
});

test('each eligibility filter retains exactly its own category',()=>{
 assert.deepEqual(filterOpportunities(jobs,'','verified_eligible').map(j=>j.id),['a']);
 assert.deepEqual(filterOpportunities(jobs,'','likely_eligible').map(j=>j.id),['b']);
 assert.deepEqual(filterOpportunities(jobs,'','ineligible').map(j=>j.id),['c']);
 assert.deepEqual(filterOpportunities(jobs,'','unverified').map(j=>j.id),['d','e','f']);
 assert.equal(filterOpportunities(jobs,'','all').length,6);
});

test('search is case-insensitive and can be combined with eligibility filter',()=>{
 assert.deepEqual(filterOpportunities(jobs,' engineer ','verified_eligible').map(j=>j.id),['a']);
 assert.deepEqual(filterOpportunities(jobs,'merIDian','unverified').map(j=>j.id),['d']);
 assert.deepEqual(filterOpportunities(jobs,'not a company','all'),[]);
});

test('missing optional text cannot crash search or create a positive status',()=>{
 const item={id:'x',company_name:null,title:undefined,eligibility:undefined};
 assert.deepEqual(filterOpportunities([item],'','unverified'),[item]);
 assert.deepEqual(filterOpportunities([item],'query','all'),[]);
});

test('expired positive assessment stays outside current eligible groups',()=>{
 const expired={id:'expired',company_name:'Old',title:'Role',eligibility:'verified_eligible',eligibility_expired:true};
 assert.equal(eligibilityGroup('verified_eligible',true),'unverified');
 assert.deepEqual(filterOpportunities([expired],'','verified_eligible'),[]);
 assert.deepEqual(filterOpportunities([expired],'','unverified'),[expired]);
});
