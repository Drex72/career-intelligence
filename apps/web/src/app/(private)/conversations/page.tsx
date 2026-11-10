'use client';
import {PageHeading} from '@/components/WorkspaceUI';
import { useMemo,useState,type FormEvent } from 'react';
import { useResource } from '@/components/useResource';
import { useCareerSession } from '@/components/AuthGate';
import { ciFetch } from '@/lib/api';
import { ResourceTable, StateNotice, Status } from '@/components/ResourceTable';
import { safeDateLabel } from '@/lib/data.mjs';

type Draft={id:string,job_id:string,contact_id:string,subject:string};
type Event={id:string,company_name:string,title:string,contact_name:string,event_type:string,occurred_at:string,evidence:{text?:string;source_url?:string}};

export default function Conversations(){
  const session=useCareerSession();
  const drafts=useResource<{drafts:Draft[]}>('outreach');
  const events=useResource<{events:Event[]}>('conversations');
  const [draftId,setDraftId]=useState('');const [source,setSource]=useState('');const [body,setBody]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const draft=useMemo(()=>drafts.data?.drafts.find(d=>d.id===draftId),[draftId,drafts.data]);
  async function submit(e:FormEvent){
    e.preventDefault();if(!draft||!source||!body)return;
    setBusy(true);setMessage('');
    try{const response=await ciFetch<{recorded:boolean;classification:string}>('conversations',session,{
      method:'POST',body:JSON.stringify({job_id:draft.job_id,contact_id:draft.contact_id,source_url:source,body})});
      setMessage(response.recorded?`Reply recorded as ${response.classification}; employer evidence requires verification.`:'This reply is already recorded.');
      if(response.recorded){setBody('');setSource('');events.reload();}}
    catch(error){setMessage(error instanceof Error?error.message:'Could not record the reply');}
    finally{setBusy(false);}
  }
  return <><PageHeading meta="FOLLOW UP / LEARN" title="Conversations" description="Keep a dependable record of recruiter replies and what they actually say."/>
    <section className="workspace-surface guidance-surface"><h3>Source verification</h3><p>Only submit replies you received. Employer restrictions remain user-reported evidence until independently verified. This screen never sends email.</p></section>
    <section className="workspace-surface"><div className="section-title"><h2>Record a recruiter reply</h2></div>
      <form className="application-form" onSubmit={submit}>
        <label>Existing draft<select required value={draftId} onChange={e=>setDraftId(e.target.value)}><option value="">Select job and contact</option>
          {(drafts.data?.drafts||[]).map(d=><option key={d.id} value={d.id}>{d.subject}</option>)}</select></label>
        <label>Evidence link<input type="url" required placeholder="https://mail.google.com/mail/..." value={source} onChange={e=>setSource(e.target.value)}/></label>
        <label className="notes-field">Reply text<input required maxLength={4000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Exact reply received"/></label>
        <button disabled={busy||!draftId||!body||!source} type="submit">{busy?'Recording…':'Record reply'}</button>
      </form><p aria-live="polite" className="muted">{message}</p></section>
    <section className="workspace-surface"><StateNotice loading={events.loading} error={events.error}/>
      {events.data&&<ResourceTable items={events.data.events} columns={[
        {key:'contact',label:'Contact',render:r=><strong>{r.contact_name||'Unknown'}</strong>},
        {key:'company',label:'Company',render:r=>r.company_name||'Unknown'},
        {key:'event',label:'Result',render:r=><Status value={r.event_type}/>},
        {key:'date',label:'Recorded',render:r=>safeDateLabel(r.occurred_at)},
      ]} empty="No recorded replies yet."/>}</section>
  </>;
}
