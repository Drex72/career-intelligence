/** Plain-data eligibility filters; never infer a positive hiring decision. */
const eligible='verified_eligible';
const likely='likely_eligible';
const ineligible='ineligible';

export function eligibilityGroup(status){
  if(status===eligible||status===likely||status===ineligible)return status;
  return 'unverified';
}

export function filterOpportunities(jobs,query='',filter='all'){
  const normalized=query.trim().toLocaleLowerCase();
  return jobs.filter(job=>{
    const terms=`${job.company_name??''} ${job.title??''}`.toLocaleLowerCase();
    return terms.includes(normalized)&&(filter==='all'||eligibilityGroup(job.eligibility)===filter);
  });
}
