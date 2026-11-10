'use client';
import { useResource } from '@/components/useResource';
import { StateNotice } from '@/components/ResourceTable';
type Operations={states:Record<string,number>};
export default function Operations(){
  const {data,error,loading,reload}=useResource<Operations>('operations');
  return <><header className="page-header"><div><span className="eyebrow">WORKFLOW RELIABILITY</span><h1>Agent operations</h1>
    <p className="muted">Actual durable tasks tracked by PostgreSQL, with no simulated metrics.</p></div>
    <button className="outline-button" onClick={reload}>Refresh</button></header>
    <StateNotice loading={loading} error={error}/>
    <section className="metric-grid">{Object.entries(data?.states||{}).map(([state,count])=><div className="metric" key={state}>
      <span>{state.replace(/_/g,' ')}</span><strong>{count}</strong></div>)}</section>
    {data&&Object.keys(data.states).length===0&&<div className="empty-state">No PostgreSQL workflow tasks have been created yet.</div>}
  </>;
}
