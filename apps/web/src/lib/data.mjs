const labels={verified_eligible:'Verified eligible',likely_eligible:'Likely eligible',unknown:'Unknown',ineligible:'Ineligible',applied:'Applied',interviewing:'Interviewing',saved:'Saved'};
export function formatStatus(value){return labels[value] || String(value || 'Unknown').replace(/_/g,' ').replace(/^./,s=>s.toUpperCase());}
export function safeDateLabel(value){
  if(!value)return 'Not provided';
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return 'Not provided';
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
}
export function rankedOpportunities(items){return [...items].sort((a,b)=>a.rank-b.rank);}
