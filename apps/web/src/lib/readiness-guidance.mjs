/** Diagnostic advice only; never used to infer employer eligibility. */
export function readinessGuidance(stats){
  if(!stats)return [];
  const items=[];
  if(stats.discovered_jobs===0)items.push('No jobs are stored. Check the scheduled worker and public feed quotas.');
  if(stats.discovered_jobs>0&&stats.open_jobs===0)items.push('No listings are confirmed open. Feed imports are discovery-only until their current status is independently verified.');
  if(stats.discovered_jobs>0&&stats.recent_confirmed_publication===0)items.push('No jobs have an independently confirmed publication date within seven days. Last-updated timestamps do not count as new postings.');
  if(stats.eligibility_assessments===0)items.push('No role-specific eligibility assessments exist yet. Review a registered official ATS job before expecting verified recommendations.');
  if(stats.eligibility_evidence===0)items.push('No eligibility evidence is stored. A remote label alone is insufficient to verify Nigeria-based hiring.');
  if(stats.active_ats_boards===0&&stats.pending_source_candidates===0)items.push('No ATS boards or pending board suggestions exist. Discovery has not yet established employer-hosted sources.');
  if(stats.pending_source_candidates>0)items.push('ATS board suggestions need your approval in Agent operations before they can be scanned.');
  return items;
}
