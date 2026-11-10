'use client';
import { useState, type FormEvent } from 'react';
import { useResource } from '@/components/useResource';
import { useCareerSession } from '@/components/AuthGate';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
import { ciFetch } from '@/lib/api';
import { safeDateLabel } from '@/lib/data.mjs';
type Job={id:string,title:string,company_name:string};
type Application={id:string,job_id:string,company_name:string,title:string,status:string,applied_at:string|null,apply_url:string};
const statuses=['saved','applied','interviewing','offer','rejected','withdrawn'];
export default function Applications(){
  const session=useCareerSession();
  const jobs=useResource<{jobs:Job[]}>('jobs');const apps=useResource<{applications:Application[]}>('applications');
  const [jobId,setJobId]=useState('');const [status,setStatus]=useState('saved');const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  async function submit(e:FormEvent){
    e.preventDefault();if(!jobId)return;setBusy(true);setMessage('');
    try{await ciFetch('applications',session,{method:'POST',body:JSON.stringify({job_id:jobId,status,notes})});
      setMessage('Application status saved.');apps.reload();}
    catch(err){setMessage(err instanceof Error?err.message:'Could not save application');}
    finally{setBusy(false);}
  }
  return <><header className="page-header"><div><span className="eyebrow">APPLICATION TRACKING</span><h1>Applications</h1>
    <p className="muted">Track applications you submit manually. The system never applies on your behalf.</p></div></header>
    <section className="panel"><div className="section-title"><h2>Record an application</h2></div>
      <form className="application-form" onSubmit={submit}>
        <label>Position<select value={jobId} required onChange={e=>setJobId(e.target.value)}><option value="">Select discovered job</option>
          {(jobs.data?.jobs||[]).map(j=><option value={j.id} key={j.id}>{j.company_name} · {j.title}</option>)}</select></label>
        <label>Status<select value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="notes-field">Notes<input maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional follow-up notes"/></label>
        <button disabled={busy||!jobId} type="submit">{busy?'Saving…':'Save status'}</button>
      </form>{message&&<p aria-live="polite" className="muted">{message}</p>}
    </section>
    <section className="panel"><div className="section-title"><h2>Application history</h2></div><StateNotice loading={apps.loading} error={apps.error}/>
      {apps.data&&<ResourceTable items={apps.data.applications} columns={[
        {key:'company',label:'Company',render:r=><strong>{r.company_name}</strong>},
        {key:'title',label:'Role',render:r=>r.title},
        {key:'status',label:'Status',render:r=><Status value={r.status}/>},
        {key:'date',label:'Applied',render:r=>safeDateLabel(r.applied_at)},
      ]} empty="No applications recorded yet."/>}</section>
  </>;
}
