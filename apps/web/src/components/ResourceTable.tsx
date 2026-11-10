import type {ReactNode} from 'react';
import {BlankSlate} from './WorkspaceUI';
import {formatStatus} from '@/lib/data.mjs';
export type Column<T>={key:string,label:string,render:(row:T)=>ReactNode};
export function ResourceTable<T>({items,columns,empty='No records available yet.',rowKey,ariaLabel}:{items:T[];columns:Column<T>[];empty?:string;rowKey?:(row:T)=>string;ariaLabel?:string}){
  if(!items.length)return <BlankSlate title="Nothing here yet" description={empty}/>;
  return <div className="table-scroll" role="region" aria-label={ariaLabel||'Records'} tabIndex={0}>
    <table><thead><tr>{columns.map(c=><th scope="col" key={c.key}>{c.label}</th>)}</tr></thead>
    <tbody>{items.map((row,index)=><tr key={rowKey?rowKey(row):index}>{columns.map(c=><td key={c.key}>{c.render(row)}</td>)}</tr>)}</tbody></table>
  </div>;
}
export function Status({value}:{value:string|null|undefined}){
  const v=value||'unverified';
  const kind=v.replace(/[^a-z_]/g,'');
  return <span className={'status status-'+kind}><span className="status-dot" aria-hidden="true"/>{formatStatus(v)}</span>;
}
export function StateNotice({loading,error}:{loading:boolean;error:string|null}){
  if(loading)return <div className="loading-state" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true"/>Loading live records…</div>;
  if(error)return <div className="error-message" role="alert"><strong>Unable to load data.</strong> {error}</div>;
  return null;
}
