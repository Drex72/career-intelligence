import test from 'node:test';
import assert from 'node:assert/strict';
import {readinessGuidance} from '../src/lib/readiness-guidance.mjs';
test('empty pipeline explains discovery and verification blockers without inventing outcomes',()=>{
 const issues=readinessGuidance({discovered_jobs:0,open_jobs:0,recent_confirmed_publication:0,eligibility_assessments:0,eligibility_evidence:0,active_ats_boards:0,pending_source_candidates:0});
 assert(issues.some(x=>x.includes('No jobs')));
 assert(issues.every(x=>!x.includes('eligible employer found')));
});
test('stored unverified jobs explain missing open, fresh and eligible evidence',()=>{
 const issues=readinessGuidance({discovered_jobs:16,open_jobs:0,recent_confirmed_publication:1,eligibility_assessments:0,eligibility_evidence:0,active_ats_boards:0,pending_source_candidates:0});
 assert(issues.some(x=>x.includes('confirmed open')));
 assert(!issues.some(x=>x.includes('No jobs are stored')));
 assert(!issues.some(x=>x.includes('No jobs have an independently')));
});
test('pending board requires approval without claiming eligibility',()=>{
 const issues=readinessGuidance({discovered_jobs:20,open_jobs:7,recent_confirmed_publication:4,eligibility_assessments:6,eligibility_evidence:6,active_ats_boards:0,pending_source_candidates:3});
 assert.equal(issues.length,1);
 assert(issues[0].includes('approval'));
});
