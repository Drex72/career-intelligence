'use client';
import {PageHeading,Notice} from '@/components/WorkspaceUI';
import {useResource} from '@/components/useResource';
import {ResourceTable,StateNotice} from '@/components/ResourceTable';
import {safeDateLabel} from '@/lib/data.mjs';

type Document={path:string,visibility:string,git_sha:string,updated_at:string};
type Sync={git_sha:string,status:string,approved_count:number,changed_count:number,
  tombstoned_count:number,skipped_count:number,finished_at:string};
type KnowledgeState={documents:Document[],last_sync:Sync|null,note:string};

export default function Knowledge(){
  const {data,error,loading,reload}=useResource<KnowledgeState>('knowledge');
  const run=data?.last_sync;
  return <><PageHeading meta="YOUR CONTEXT / DOCUMENTS" title="Knowledge base"
    description="Private, explicitly approved Obsidian notes that your career agents are allowed to use."/>
    {run?
      <Notice tone="success" title="Private vault sync completed">
        Latest sync: {safeDateLabel(run.finished_at)} · {run.approved_count} approved notes · {run.changed_count} changed · {run.tombstoned_count} removed · {run.skipped_count} skipped. Source revision {run.git_sha.slice(0,9)}.
      </Notice>:
      <Notice title="Private vault not connected yet">
        No completed sync has been recorded. The system does not import your personal notes until you configure a separate private repository and explicitly enable syncing.
      </Notice>
    }
    <section className="workspace-surface guidance-surface">
      <h3>Connect your Obsidian vault securely</h3>
      <p>Store your vault in a separate <strong>private GitHub repository</strong>, not the Career Intelligence code repository. Mark only professional notes you want indexed with the explicit approval header below.</p>
      <pre><code>{'---\nstatus: approved\nvisibility: matching-safe\n---\nYour verified experience and skills'}</code></pre>
      <p className="muted">Allowed scopes: <code>matching-safe</code>, <code>outreach-safe</code>, and <code>agents-safe</code>. Hidden folders, <code>07-private</code>, unapproved notes, symlinks and oversized files are excluded.</p>
      <p>In GitHub Actions, set the repository variable <code>CI_KNOWLEDGE_REPO</code> to your private vault repository, add a fine-grained read-only <code>CI_KNOWLEDGE_TOKEN</code> secret and your existing <code>CI_DATABASE_URL</code> secret, then set <code>CI_KNOWLEDGE_SYNC=true</code>. Run the private knowledge-sync workflow to validate and import only approved notes.</p>
      <p className="muted">Your private vault and GitHub credentials never belong in the public application repository. The browser receives metadata only, not the note contents.</p>
    </section>
    <section className="workspace-surface">
      <div className="section-title"><div><h2>Indexed documents</h2><p className="muted">Only documents with explicit approval are included. The latest sync's removals disappear from retrieval.</p></div>
        <button type="button" className="button-secondary" onClick={()=>reload()}>Refresh status</button>
      </div>
      <StateNotice loading={loading} error={error} retry={reload}/>
      {data&&<ResourceTable items={data.documents} rowKey={r=>r.path}
        ariaLabel="Approved knowledge documents"
        columns={[
          {key:'path',label:'Document',render:r=><strong>{r.path}</strong>},
          {key:'scope',label:'Agent visibility',render:r=>r.visibility},
          {key:'revision',label:'Revision',render:r=><code>{r.git_sha==='local'?'Local':r.git_sha.slice(0,9)}</code>},
          {key:'updated',label:'Updated',render:r=>safeDateLabel(r.updated_at)},
        ]} empty="No approved Obsidian notes are indexed. No personal claims will be invented."/>}
    </section>
  </>;
}
