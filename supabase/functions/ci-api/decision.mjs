/** Presentation gate aligned with evidence-backed daily delivery rules. */
export function currentEligibility(latest,hasEvidence,now=Date.now()){
  if(!latest)return {status:'unknown',expired:false,reason:'No eligibility assessment'};
  const expires=latest.expires_at?Date.parse(latest.expires_at):null;
  if(expires!==null&&(!Number.isFinite(expires)||expires<=now))
    return {status:'unknown',expired:true,reason:'Assessment expired; fresh employer evidence required'};
  if(latest.status==='verified_eligible'&&!hasEvidence)
    return {status:'unknown',expired:false,reason:'No source evidence supports the assessment'};
  const status=['verified_eligible','likely_eligible','unknown','ineligible'].includes(latest.status)
    ?latest.status:'unknown';
  return {status,expired:false,reason:null};
}
export function visibleMatchScore(match,eligibility,taskState){
  if(eligibility?.status!=='verified_eligible'||taskState!=='completed')return 0;
  const score=Number(match?.score);
  return Number.isInteger(score)&&score>=0&&score<=100?score:0;
}
