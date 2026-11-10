import type { ReactNode } from 'react';
export type Column<T>={key:string,label:string,render:(row:T)=>ReactNode};
export function ResourceTable<T>({items,columns,empty='No records available yet.'}:{items:T[],columns:Column<T>[],empty?:string}){
  if (!items.length)return <div className="empty-state">{empty}</div>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead>
    <tbody>{items.map((row,index)=><tr key={index}>{columns.map(c=><td key={c.key}>{c.render(row)}</td>)}</tr>)}</tbody></table></div>;
}
export function Status({value}:{value:string|null|undefined}){
  const v=value||'unknown';return <span className={'status status-'+v.replace(/[^a-z_]/g,'')}>{v.replace(/_/g,' ')}</span>;
}
export function StateNotice({loading,error}:{loading:boolean,error:string|null}){
  if(loading)return <div className="loading">Loading live records…</div>;
  if(error)return <div className="error-message" role="alert">{error}</div>;
  return null;
}
