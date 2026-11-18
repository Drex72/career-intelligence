'use client';
import {useState} from 'react';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {useResource} from '@/components/useResource';
import {ResourceTable,StateNotice} from '@/components/ResourceTable';
import {SectionHeading,Notice} from '@/components/WorkspaceUI';
import {safeDateLabel} from '@/lib/data.mjs';
import {countryName} from '@/lib/targeting.mjs';

type LikelyItem={
  job_id:string;company_name:string;title:string;apply_url:string;published_at:string|null;
  reason:string;worldwide_scope:boolean;us_employer_evidence:boolean;decision:'confirmed'|null;
};

function Check({ok,yes,no}:{ok:boolean;yes:string;no:string}){
  return <span className={'status '+(ok?'status-verified':'status-unknown')}>
    <span aria-hidden="true">{ok?'✓':'–'}</span> {ok?yes:no}
  </span>;
}

/** Roles whose official posting says remote worldwide but does not name the applicant's country.
 *  Shown apart from today's list and never counted toward it. */
export function LikelyTier({country,employerCountry}:{country:string;employerCountry:string|null}){
  const session=useCareerSession();
  const likely=useResource<{items:LikelyItem[];note:string}>('likely');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  async function decide(jobId:string,decision:'confirmed'|'dismissed'){
    setBusy(jobId);setError('');
    try{
      await ciFetch('likely/decision',session,{method:'POST',body:JSON.stringify({job_id:jobId,decision})});
      likely.reload();
    }catch(e){setError(e instanceof Error?e.message:'Could not save your decision');}
    finally{setBusy('');}
  }
  // The employer-country check only exists for US today; show it only when that is the chosen filter.
  const showEmployer=employerCountry==='US';
  return <section className="workspace-surface likely-surface" style={{marginTop:20}}>
    <SectionHeading title="Worth a look: needs your confirmation"
      description={'The employer’s posting says “remote worldwide” but doesn’t name '+country+'. Ask the employer before applying. These are kept separate and never count toward today’s list.'}/>
    {error&&<Notice tone="danger">{error}</Notice>}
    <StateNotice loading={likely.loading} error={likely.error} retry={likely.reload}/>
    {likely.data&&<ResourceTable rowKey={r=>r.job_id} ariaLabel="Roles awaiting your confirmation" items={likely.data.items} columns={[
      {key:'company',label:'Employer',render:r=><strong>{r.company_name}</strong>},
      {key:'job',label:'Role',render:r=><span className="role-name">{r.title}</span>},
      {key:'evidence',label:'What we found',render:r=><span className="chip-row">
        <Check ok={r.worldwide_scope} yes="Says worldwide" no="Scope unclear"/>
        {showEmployer&&<Check ok={r.us_employer_evidence} yes={'Based in '+countryName('US')} no="Headquarters unconfirmed"/>}</span>},
      {key:'published',label:'Posted',render:r=><span className="muted">{safeDateLabel(r.published_at)}</span>},
      {key:'actions',label:'Your decision',render:r=><span className="chip-row">
        {r.apply_url?<a href={r.apply_url} rel="noopener noreferrer" target="_blank" className="table-action">View posting<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span></a>:<span className="muted">No link</span>}
        {r.decision==='confirmed'
          ?<span className="status status-verified">✓ You confirmed</span>
          :<button type="button" className="button-secondary" disabled={busy===r.job_id} onClick={()=>void decide(r.job_id,'confirmed')}
              aria-label={'Mark '+r.title+' at '+r.company_name+' as open to me'}>It’s open to me</button>}
        <button type="button" className="table-action" disabled={busy===r.job_id} onClick={()=>void decide(r.job_id,'dismissed')}
          aria-label={'Hide '+r.title+' at '+r.company_name}>Not for me</button>
      </span>},
    ]} empty="Nothing to confirm right now. Roles appear here when an employer’s posting says remote worldwide without naming your country."/>}
  </section>;
}
