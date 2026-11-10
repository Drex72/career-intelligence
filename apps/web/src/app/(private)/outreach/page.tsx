'use client';
import {PageHeading} from '@/components/WorkspaceUI';
import { useMemo, useState, type FormEvent } from 'react';
import { useResource } from '@/components/useResource';
import { useCareerSession } from '@/components/AuthGate';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
import { ciFetch } from '@/lib/api';

type Job={id:string,title:string,company_name:string,company_id:string,eligibility:string};
type Contact={id:string,name:string,company_id:string};
type Draft={id:string,subject:string,body:string,status:string,created_at:string};
export default function Outreach(){
  const session=useCareerSession();
  const drafts=useResource<{drafts:Draft[]}>('outreach');
  const jobs=useResource<{jobs:Job[]}>('jobs');
  const people=useResource<{contacts:Contact[]}>('people');
  const [jobId,setJobId]=useState('');const [contactId,setContactId]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const selectedJob=jobs.data?.jobs.find(j=>j.id===jobId);
  const contacts=useMemo(()=>people.data?.contacts.filter(p=>p.company_id===selectedJob?.company_id)||[],[people.data,selectedJob?.company_id]);
  const eligibleJobs=jobs.data?.jobs.filter(j=>j.eligibility==='verified_eligible')||[];
  async function submit(e:FormEvent){
    e.preventDefault();if(!jobId||!contactId)return;
    setBusy(true);setMessage('');
    try{await ciFetch('outreach/drafts',session,{method:'POST',body:JSON.stringify({job_id:jobId,contact_id:contactId})});
      setMessage('Draft prepared for your review. No email was sent.');drafts.reload();}
    catch(error){setMessage(error instanceof Error?error.message:'Could not create draft');}
    finally{setBusy(false);}
  }
  return <><PageHeading meta="CONNECT / COMMUNICATE" title="Outreach workspace" description="Prepare thoughtful, evidence-backed messages while keeping every send under your control."/>
    <section className="workspace-surface guidance-surface"><h3>Automatic sending is off</h3><p>Draft generation cannot authorize or dispatch email. Sending requires separate approval and a verified application.</p></section>
    <div className="split-workflow"><section className="workspace-surface"><div className="section-title"><h2>Prepare a draft</h2></div>
      <form className="application-form" onSubmit={submit}>
        <label>Eligible position<select required value={jobId} onChange={e=>{setJobId(e.target.value);setContactId('');}}><option value="">Choose verified eligible job</option>
          {eligibleJobs.map(j=><option key={j.id} value={j.id}>{j.company_name} · {j.title}</option>)}</select></label>
        <label>Company contact<select required value={contactId} onChange={e=>setContactId(e.target.value)}><option value="">Choose sourced contact</option>
          {contacts.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <button disabled={!jobId||!contactId||busy} type="submit">{busy?'Preparing…':'Create draft'}</button>
      </form><p aria-live="polite" className="muted">{message}</p>
      {selectedJob&&contacts.length===0&&<p className="muted">No sourced people at this company yet. Employee research may still be pending.</p>}
    </section>
    <section className="workspace-surface"><div className="section-title"><h2>Your drafts</h2><p className="muted">Private drafts prepared for review. No messages have been sent.</p></div><StateNotice loading={drafts.loading} error={drafts.error}/>
      {drafts.data&&<ResourceTable items={drafts.data.drafts} columns={[
        {key:'subject',label:'Subject',render:r=><strong>{r.subject}</strong>},
        {key:'preview',label:'Preview',render:r=><span className="muted">{r.body.slice(0,140)}{r.body.length>140?'…':''}</span>},
        {key:'status',label:'Status',render:r=><Status value={r.status}/>},
      ]} empty="No outreach drafts yet."/>}</section>
    </div>
  </>;
}
