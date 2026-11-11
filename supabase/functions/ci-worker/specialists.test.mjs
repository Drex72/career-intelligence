import test from 'node:test';
import assert from 'node:assert/strict';
import {safeVerifiedDomain,extractOfficialPeople,classifyReply} from './specialists.mjs';
test('people research refuses private and malformed domains',()=>{
 for(const d of ['localhost','127.0.0.1','test.local','internal.example','example.test','a.example.com@localhost','a..com','10.1.2.3','fake.localhost'])
   assert.equal(safeVerifiedDomain(d),false,d);
 assert.equal(safeVerifiedDomain('engineering.example.org'),true);
});
test('people extractor needs on-domain employer-authored structured data',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@graph':[
  {'@type':'Person',name:'Alex Example',jobTitle:'Engineering Manager',url:'https://company.example.org/team/alex'},
  {'@type':'Person',name:'Outside Person',jobTitle:'Recruiter',url:'https://evil.example.com/fake'}
 ]})+'</script>';
 const xs=extractOfficialPeople(html,'company.example.org');
 assert.deepEqual(xs,[{name:'Alex Example',title:'Engineering Manager',
   url:'https://company.example.org/team/alex'}]);
 assert.deepEqual(extractOfficialPeople(html,'localhost'),[]);
});
test('conversation classifier prioritizes opt out and does not send anything',()=>{
 assert.equal(classifyReply('Please unsubscribe, I can refer you'), 'opt_out');
 assert.equal(classifyReply('Happy to refer you'),'referral');
 assert.equal(classifyReply('Can we schedule a call?'),'interview');
 assert.equal(classifyReply('Unfortunately we are not hiring'),'declined');
 assert.equal(classifyReply('Hello there'),'other');
});
