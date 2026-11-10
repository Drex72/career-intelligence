'use client';
import { useResource } from '@/components/useResource';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
type Draft={id:string,subject:string,body:string,status:string,created_at:string};
export default function Outreach(){
  const {data,error,loading}=useResource<{drafts:Draft[]}>('outreach');
  return <><header className="page-header"><div><span className="eyebrow">NETWORKING</span><h1>Outreach workspace</h1>
    <p className="muted">Review personalized drafts. No messages are sent from this screen.</p></div></header>
    <section className="info-panel"><h3>Automatic sending is off</h3><p>Email authorization requires a separate approved policy. Draft generation and research do not grant permission to send messages.</p></section>
    <section className="panel"><StateNotice loading={loading} error={error}/>
      {data&&<ResourceTable items={data.drafts} columns={[
        {key:'subject',label:'Subject',render:r=><strong>{r.subject}</strong>},
        {key:'preview',label:'Preview',render:r=><span className="muted">{r.body.slice(0,140)}{r.body.length>140?'…':''}</span>},
        {key:'status',label:'Status',render:r=><Status value={r.status}/>},
      ]} empty="No outreach drafts yet."/>}</section>
  </>;
}
