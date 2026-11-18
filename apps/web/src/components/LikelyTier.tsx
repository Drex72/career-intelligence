'use client';
import {useState} from 'react';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {useResource} from '@/components/useResource';
import {ResourceTable,StateNotice} from '@/components/ResourceTable';
import {SectionHeading,Notice} from '@/components/WorkspaceUI';
import {safeDateLabel} from '@/lib/data.mjs';

type LikelyItem={
  job_id:string;company_name:string;title:string;apply_url:string;published_at:string|null;
  reason:string;worldwide_scope:boolean;us_employer_evidence:boolean;decision:'confirmed'|null;
};

function Flag({ok,label}:{ok:boolean;label:string}){
  return <span className={'status '+(ok?'status-verified':'status-unknown')}
    title={ok?label+': official evidence on file':label+': no evidence yet'}>
    <span aria-hidden="true">{ok?'✓':'–'}</span> {label}
  </span>;
}

/** Roles whose official posting says remote worldwide but does not name Nigeria.
 *  Shown apart from verified recommendations and never counted toward them. */
export function LikelyTier(){
  const session=useCareerSession();
  const likely=useResource<{items:LikelyItem[];note:string}>('likely');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  async function decide(jobId:string,decision:'confirmed'|'dismissed'){
    setBusy(jobId);setError('');
    try{
      await ciFetch('likely/decision',session,{method:'POST',body:JSON.stringify({job_id:jobId,decision})});
      likely.reload();
    }catch(e){setError(e instanceof Error?e.message:'Unable to save decision');}
    finally{setBusy('');}
  }
  return <section className="workspace-surface likely-surface" style={{marginTop:20}}>
    <SectionHeading title="Likely eligible — needs your confirmation"
      description="The official posting says remote worldwide but does not mention Nigeria. Check with the employer before applying. These never count as verified recommendations."/>
    {error&&<Notice tone="danger">{error}</Notice>}
    <StateNotice loading={likely.loading} error={likely.error} retry={likely.reload}/>
    {likely.data&&<ResourceTable rowKey={r=>r.job_id} ariaLabel="Likely eligible roles awaiting your confirmation" items={likely.data.items} columns={[
      {key:'company',label:'Employer',render:r=><strong>{r.company_name}</strong>},
      {key:'job',label:'Role',render:r=><span className="role-name">{r.title}</span>},
      {key:'published',label:'Published',render:r=><span className="muted">{safeDateLabel(r.published_at)}</span>},
      {key:'evidence',label:'Evidence',render:r=><span style={{display:'inline-flex',gap:6,flexWrap:'wrap'}}>
        <Flag ok={r.worldwide_scope} label="Worldwide scope"/><Flag ok={r.us_employer_evidence} label="US employer"/></span>},
      {key:'actions',label:'Your call',render:r=><span style={{display:'inline-flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        {r.apply_url?<a href={r.apply_url} rel="noopener noreferrer" target="_blank" className="table-action">Posting <span aria-hidden="true">↗</span></a>:<span className="muted">No link</span>}
        {r.decision==='confirmed'
          ?<span className="status status-verified">Confirmed by you</span>
          :<button type="button" className="button-secondary" disabled={busy===r.job_id} onClick={()=>void decide(r.job_id,'confirmed')}>Confirm</button>}
        <button type="button" className="table-action" disabled={busy===r.job_id} onClick={()=>void decide(r.job_id,'dismissed')}>Dismiss</button>
      </span>},
    ]} empty="No likely-eligible roles right now. They appear here when an official posting says remote worldwide."/>}
  </section>;
}
