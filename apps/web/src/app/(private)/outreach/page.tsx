'use client';
import {PageHeading,Notice} from '@/components/WorkspaceUI';
import { useMemo, useState, type FormEvent } from 'react';
import { useResource } from '@/components/useResource';
import { useCareerSession } from '@/components/AuthGate';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
import { ciFetch } from '@/lib/api';
import { availableOutreachActions } from '@/lib/outreach-controls.mjs';

type Job={id:string,title:string,company_name:string,company_id:string,eligibility:string};
type Contact={id:string,name:string,company_id:string};
type Draft={id:string,job_id:string,contact_id:string,subject:string,body:string,status:string,created_at:string};
type Approval={draft_id:string,mode:'manual'|'standing',approved_at:string};
type Intent={id:string,draft_id:string,status:string,created_at:string,sent_at:string|null,last_attempt_at:string|null,error_code:string|null};
type OutreachData={drafts:Draft[],approvals:Approval[],intents:Intent[]};
type Action='approve'|'queue'|'revoke';
export default function Outreach(){
  const session=useCareerSession();
  const drafts=useResource<OutreachData>('outreach');
  const jobs=useResource<{jobs:Job[]}>('jobs');
  const people=useResource<{contacts:Contact[]}>('people');
  const [jobId,setJobId]=useState('');const [contactId,setContactId]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const [actionError,setActionError]=useState('');
  const [pending,setPending]=useState<{draftId:string,action:Action}|null>(null);
  const [actionBusy,setActionBusy]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const approvalFor=(id:string)=>drafts.data?.approvals?.find(a=>a.draft_id===id);
  const intentFor=(id:string)=>drafts.data?.intents?.find(i=>i.draft_id===id);
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
  async function confirmAction(){
    if(!pending||actionBusy)return;
    const {action,draftId}=pending;
    setActionBusy(true);setActionError('');setMessage('');
    const route=action==='approve'?'outreach/approve':action==='queue'?'outreach/intents':'outreach/revoke';
    try{
      const result=await ciFetch<{status?:string,note?:string}>(route,session,{
        method:'POST',
        body:JSON.stringify(action==='approve'?{draft_id:draftId,mode:'manual'}:{draft_id:draftId}),
      });
      setMessage(result.note||(
        action==='approve'?'Approval recorded. No email has been sent.':
        action==='queue'?'Pending intent created. No email has been sent.':
        'Approval revoked. Pending unsent intent cancelled.'));
      drafts.reload();setPending(null);
    }catch(err){
      setActionError(err instanceof Error?err.message:'Could not complete this action');
    }finally{setActionBusy(false);}
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
    <section className="workspace-surface"><div className="section-title"><div><h2>Your drafts and approvals</h2><p className="muted">Inspect the full message, approve manually, queue a pending intent, or revoke. No emails are sent by these actions.</p></div></div>
      <StateNotice loading={drafts.loading} error={drafts.error} retry={drafts.reload}/>
      {message&&<Notice tone="success" title="Updated">{message}</Notice>}
      {actionError&&<Notice tone="danger" title="Action blocked">{actionError}</Notice>}
      {drafts.data&&<ResourceTable items={drafts.data.drafts} rowKey={r=>r.id} ariaLabel="Outreach drafts and approval status" columns={[
        {key:'subject',label:'Subject',render:r=><strong>{r.subject}</strong>},
        {key:'status',label:'Status',render:r=><Status value={intentFor(r.id)?.status||r.status}/>},
        {key:'approval',label:'Approval',render:r=><span className="muted">{approvalFor(r.id)?'Manually approved':'Not approved'}</span>},
        {key:'actions',label:'Review and control',render:r=><div className="table-inline-actions">
          <button type="button" className="table-action" aria-expanded={expanded===r.id} onClick={()=>setExpanded(expanded===r.id?null:r.id)}>{expanded===r.id?'Hide message':'Read full draft'}</button>
          {availableOutreachActions(r,approvalFor(r.id),intentFor(r.id)).approve&&<button type="button" className="table-action" disabled={actionBusy} onClick={()=>setPending({draftId:r.id,action:'approve'})}>Approve manually</button>}
          {availableOutreachActions(r,approvalFor(r.id),intentFor(r.id)).queue&&<button type="button" className="table-action" disabled={actionBusy} onClick={()=>setPending({draftId:r.id,action:'queue'})}>Queue intent</button>}
          {availableOutreachActions(r,approvalFor(r.id),intentFor(r.id)).revoke&&<button type="button" className="table-action" disabled={actionBusy} onClick={()=>setPending({draftId:r.id,action:'revoke'})}>Revoke</button>}
        </div>},
      ]} empty="No outreach drafts yet. Drafts require verified-eligible roles and sourced contacts."/>}
      {expanded&&drafts.data?.drafts.some(d=>d.id===expanded)&&<div className="guidance-surface" aria-label="Full outreach draft">
        <h3>{drafts.data.drafts.find(d=>d.id===expanded)?.subject}</h3>
        <p style={{whiteSpace:'pre-wrap'}}>{drafts.data.drafts.find(d=>d.id===expanded)?.body}</p>
        <p className="muted">Review the exact text before granting approval. The app does not send it.</p>
      </div>}
      {pending&&<div className="guidance-surface" role="group" aria-label="Confirm outreach action">
        <h3>Confirm {pending.action==='approve'?'manual approval':pending.action==='queue'?'intent creation':'revocation'}</h3>
        <p className="muted">
          {pending.action==='approve'?'You are authorizing this specific draft only. It still will not be sent. The server requires an application, eligible role, verified professional email and no suppression record.':
           pending.action==='queue'?'This records one idempotent pending Gmail intent for a previously approved draft. The dispatcher is disabled, so it will not send an email.':
           'Revoke authorization and cancel any pending unsent intent. An already-sent email cannot be recalled, and an uncertain attempt requires manual reconciliation.'}
        </p>
        <div className="table-inline-actions">
          <button type="button" className="button-primary" disabled={actionBusy} onClick={()=>void confirmAction()}>{actionBusy?'Processing…':'Confirm'}</button>
          <button type="button" className="button-secondary" disabled={actionBusy} onClick={()=>{setPending(null);setActionError('');}}>Cancel</button>
        </div>
      </div>}
      {drafts.data&&(drafts.data.intents?.length||0)>0&&<div className="guidance-surface">
        <h3>Durable intent history</h3>
        <p className="muted">Pending means queued in the database, not delivered to Gmail.</p>
        <ResourceTable items={drafts.data.intents} rowKey={r=>r.id} ariaLabel="Outreach send intent history" columns={[
          {key:'subject',label:'Draft',render:r=>drafts.data?.drafts.find(d=>d.id===r.draft_id)?.subject||'Unknown draft'},
          {key:'status',label:'Status',render:r=><Status value={r.status}/>},
          {key:'created',label:'Created',render:r=>new Date(r.created_at).toLocaleString()},
        ]}/>
      </div>}
    </section>
    </div>
  </>;
}
