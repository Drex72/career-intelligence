import test from 'node:test';
import assert from 'node:assert/strict';
import {textLocationRule,analyzeJobicy,analyzeWWR} from './boards.mjs';
const now=Date.parse('2026-11-18T12:00:00Z');

test('only exact worldwide phrases become worldwide rules',()=>{
 assert.deepEqual(textLocationRule('Anywhere'),{worldwide:true,countries:[]});
 assert.deepEqual(textLocationRule('Anywhere in the World'),{worldwide:true,countries:[]});
 assert.equal(textLocationRule('Anywhere in the US'),null);
 assert.equal(textLocationRule('Remote'),null);
 assert.equal(textLocationRule(''),null);
});
test('country lists keep known countries and drop regions and qualifiers',()=>{
 assert.deepEqual(textLocationRule('USA Only'),{worldwide:false,countries:['US']});
 assert.deepEqual(textLocationRule('Germany,  Ireland,  Spain, UK'),{worldwide:false,countries:['DE','ES','GB','IE']});
 assert.deepEqual(textLocationRule('Nigeria, Kenya or South Africa'),{worldwide:false,countries:['KE','NG','ZA']});
 assert.equal(textLocationRule('EMEA Only'),null);
 assert.equal(textLocationRule('USA, Canada, USA timezones').countries.includes('NG'),false);
 assert.equal(textLocationRule('Anywhere except Nigeria'),null);
 assert.equal(textLocationRule('Worldwide, not Nigeria'),null);
});
test('Jobicy keeps the board job URL, filters role, source and age',()=>{
 const base={id:'1',url:'https://jobicy.com/jobs/1-backend-engineer',jobTitle:'Backend Engineer',
  companyName:'Acme',jobGeo:'Anywhere',pubDate:'2026-11-17T04:45:07+00:00'};
 const r=analyzeJobicy({jobs:[base,
  {...base,id:'2',jobTitle:'Interpreter'},
  {...base,id:'3',url:'https://evil.example/jobs/3'},
  {...base,id:'4',pubDate:'2026-10-01T00:00:00+00:00'}]},now);
 assert.equal(r.jobs.length,1);
 assert.equal(r.jobs[0].url,'https://jobicy.com/jobs/1-backend-engineer');
 assert.deepEqual(r.jobs[0].rule,{worldwide:true,countries:[]});
 assert.deepEqual(r.excluded,{role:1,source:1,stale:1});
 assert.equal(analyzeJobicy({jobs:[{...base,jobTitle:'Product Designer'}]},now,['designer']).jobs.length,1);
 assert.throws(()=>analyzeJobicy({},now));
});
test('WWR splits company and role, decodes entities and prefers country over region',()=>{
 const item=(title,region,country,link,date='Tue, 17 Nov 2026 11:32:03 +0000')=>
  `<item><title>${title}</title><region>${region}</region><country>${country}</country><link>${link}</link><pubDate>${date}</pubDate></item>`;
 const xml='<rss><channel>'+
  item('Acme &amp; Co: Senior Backend Engineer','Anywhere in the World','','https://weworkremotely.com/remote-jobs/acme-backend')+
  item('Beta: Full-Stack Developer','Africa Only','Nigeria','https://weworkremotely.com/remote-jobs/beta-fs')+
  item('Gamma: Sales Lead','Anywhere in the World','','https://weworkremotely.com/remote-jobs/gamma')+
  item('Delta: Software Engineer','USA Only','','https://other.example/remote-jobs/delta')+
  item('Eps: Software Engineer','Anywhere in the World','','https://weworkremotely.com/remote-jobs/eps','Mon, 01 Sep 2026 00:00:00 +0000')+
  '</channel></rss>';
 const r=analyzeWWR(xml,now);
 assert.equal(r.jobs.length,2);
 assert.equal(r.jobs[0].company,'Acme & Co');
 assert.equal(r.jobs[0].title,'Senior Backend Engineer');
 assert.equal(r.jobs[0].sourceId,'acme-backend');
 assert.equal(r.jobs[0].rule.worldwide,true);
 assert.deepEqual(r.jobs[1].rule,{worldwide:false,countries:['NG']});
 assert.deepEqual(r.excluded,{role:1,source:1,stale:1});
 assert.throws(()=>analyzeWWR('not a feed',now));
});
