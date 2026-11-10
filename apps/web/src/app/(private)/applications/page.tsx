'use client';
import {useState,type FormEvent} from 'react';
import {useResource} from '@/components/useResource';
import {useCareerSession} from '@/components/AuthGate';
import {ResourceTable,StateNotice,Status} from '@/components/ResourceTable';
import {PageHeading,SectionHeading,Notice} from '@/components/WorkspaceUI';
import {ciFetch} from '@/lib/api';
import {safeDateLabel} from '@/lib/data.mjs';
type Job={id:string;title:string;company_name:string};
type Application={id:string;job_id:string;company_name:string;title:string;status:string;applied_at:string|null;apply_url:string};
const statuses=['saved','applied','interviewing','offer','rejected','withdrawn'];
export default function Applications(){
  const session=useCareerSession();
  const jobs=useResource<{jobs:Job[]}>('jobs');
  const apps=useResource<{applications:Application[]}>('applications');
  const [jobId,setJobId]=useState('');const [status,setStatus]=useState('saved');const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  const records=apps.data?.applications||[];
  const inProgress=records.filter(a=>a.status==='applied'||a.status==='interviewing').length;
  const interviews=records.filter(a=>a.status==='interviewing').length;
  async function submit(e:FormEvent){
    e.preventDefault();if(!jobId)return;setBusy(true);setMessage('');setError('');
    try{await ciFetch('applications',session,{method:'POST',body:JSON.stringify({job_id:jobId,status,notes})});
      setMessage('Application status saved.');apps.reload();setNotes('');}
    catch(err){setError(err instanceof Error?err.message:'Could not save application');}
    finally{setBusy(false);}
  }
  return <div className="applications-page">
    <PageHeading meta="TRACK / FOLLOW UP" title="Applications" description="A home for every role you've applied to, with the next step always in view."/>
    <div className="application-summary">
      <div><span>Total tracked</span><strong>{apps.loading?'—':records.length}</strong></div>
      <div><span>In progress</span><strong>{apps.loading?'—':inProgress}</strong></div>
      <div><span>Interviewing</span><strong>{apps.loading?'—':interviews}</strong></div>
      <p>Applications are recorded manually. Career Intelligence never submits one on your behalf.</p>
    </div>
    <div className="applications-layout">
      <section className="workspace-surface application-history">
        <SectionHeading title="Your applications" description="Positions you're following, from saved through offer."/>
        <StateNotice loading={apps.loading} error={apps.error}/>
        {apps.data&&<ResourceTable rowKey={r=>r.id} ariaLabel="Application history" items={records} columns={[
          {key:'company',label:'Role and employer',render:r=><div className="job-identity"><span className="company-avatar" aria-hidden="true">{r.company_name.charAt(0).toUpperCase()}</span><div><strong>{r.title}</strong><span>{r.company_name}</span></div></div>},
          {key:'status',label:'Stage',render:r=><Status value={r.status}/>},
          {key:'date',label:'Applied',render:r=><span className="muted">{safeDateLabel(r.applied_at)}</span>},
        ]} empty="You haven't recorded an application yet. Choose a discovered job to start tracking your progress."/>}
      </section>
      <aside className="workspace-surface application-editor">
        <SectionHeading title="Update an application" description="Record what you've done and keep a useful paper trail."/>
        <form className="stacked-form" onSubmit={submit}>
          <label>Position<select value={jobId} required onChange={e=>setJobId(e.target.value)}><option value="">Choose a discovered role</option>{(jobs.data?.jobs||[]).map(j=><option key={j.id} value={j.id}>{j.company_name} · {j.title}</option>)}</select></label>
          <label>Current stage<select value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(s=><option value={s} key={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></label>
          <label>Notes <span className="optional-label">Optional</span><textarea rows={4} maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Interview details, next steps, or a follow-up reminder"/></label>
          {message&&<Notice tone="success">{message}</Notice>}{error&&<Notice tone="danger">{error}</Notice>}
          <button className="button-primary" disabled={busy||!jobId} type="submit">{busy?'Saving…':'Save application status'}</button>
        </form>
      </aside>
    </div>
  </div>;
}
