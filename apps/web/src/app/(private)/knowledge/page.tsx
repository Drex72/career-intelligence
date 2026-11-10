'use client';
import {PageHeading} from '@/components/WorkspaceUI';
import { useResource } from '@/components/useResource';
import { ResourceTable,StateNotice } from '@/components/ResourceTable';
import { safeDateLabel } from '@/lib/data.mjs';
type Document={path:string,visibility:string,git_sha:string,updated_at:string};
export default function Knowledge(){
  const {data,error,loading}=useResource<{documents:Document[]}>('knowledge');
  return <><PageHeading meta="YOUR CONTEXT / DOCUMENTS" title="Knowledge base" description="See which approved professional notes are available to your career research workflows."/>
    <section className="workspace-surface guidance-surface"><h3>Edit in Obsidian</h3><p>Update approved Markdown notes in your private vault and run <code>pg-vault-sync</code> to refresh this index. Private notes are excluded. Automatic Git sync has not been configured.</p></section>
    <section className="workspace-surface"><div className="section-title"><h2>Indexed documents</h2></div><StateNotice loading={loading} error={error}/>
      {data&&<ResourceTable items={data.documents} columns={[
        {key:'path',label:'Document',render:r=><strong>{r.path}</strong>},
        {key:'scope',label:'Agent visibility',render:r=>r.visibility},
        {key:'revision',label:'Revision',render:r=><code>{r.git_sha==='local'?'Local':r.git_sha.slice(0,9)}</code>},
        {key:'updated',label:'Updated',render:r=>safeDateLabel(r.updated_at)},
      ]} empty="Your approved personal knowledge vault has not been synchronized."/>}</section>
  </>;
}
