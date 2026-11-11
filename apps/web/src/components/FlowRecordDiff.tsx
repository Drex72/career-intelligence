'use client';
import {useMemo,useState} from 'react';

type Props={before:unknown;after:unknown};
type Flat={path:string;value:unknown};
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
function flatten(input:unknown,prefix='',out:Flat[]=[],depth=0):Flat[]{
 if(depth>5||out.length>=120)return out;
 if(record(input)&&Object.keys(input).length){
   for(const key of Object.keys(input)){
     if(out.length>=120)break;
     flatten(input[key],prefix?prefix+'.'+key:key,out,depth+1);
   }
 }else if(Array.isArray(input)&&input.length&&input.length<=12){
   input.forEach((item,i)=>{if(out.length<120)flatten(item,prefix+'['+i+']',out,depth+1);});
 }else out.push({path:prefix||'(value)',value:input});
 return out;
}
function renderValue(value:unknown){
 if(value===undefined)return <span className="factory-field-empty">Not present</span>;
 if(value===null)return <span className="factory-field-null">null</span>;
 if(typeof value==='boolean')return <span className="factory-field-bool">{String(value)}</span>;
 if(typeof value==='number')return <span className="factory-field-number">{value}</span>;
 if(typeof value==='string')return <span className="factory-field-string" title={value}>{value||'“”'}</span>;
 return <span title={JSON.stringify(value)}>{JSON.stringify(value)}</span>;
}
export function FlowRecordDiff({before,after}:Props){
 const [display,setDisplay]=useState<'fields'|'raw'>('fields');
 const rows=useMemo(()=>{
  const a=flatten(before),b=flatten(after);
  const left=new Map(a.map(x=>[x.path,x.value])),right=new Map(b.map(x=>[x.path,x.value]));
  return Array.from(new Set([...left.keys(),...right.keys()])).map(path=>{
   const existsBefore=left.has(path),existsAfter=right.has(path);
   const leftValue=left.get(path),rightValue=right.get(path);
   const kind=!existsBefore?'added':!existsAfter?'removed':JSON.stringify(leftValue)===JSON.stringify(rightValue)?'same':'changed';
   return {path,leftValue,rightValue,kind};
  }).sort((a,b)=>Number(a.kind==='same')-Number(b.kind==='same')||a.path.localeCompare(b.path));
 },[before,after]);
 const changed=rows.filter(row=>row.kind!=='same').length;
 const rawBefore=JSON.stringify(before??{},null,2);
 const rawAfter=JSON.stringify(after??{},null,2);
 return <section className="factory-records" aria-label="Recorded input and output comparison">
  <div className="factory-records-toolbar"><div className="factory-records-summary">
   <strong>{rows.length} fields</strong><span>{changed} changed</span>
  </div><div className="factory-records-toggle" role="group" aria-label="Comparison display">
   <button type="button" aria-pressed={display==='fields'} className={display==='fields'?'active':''} onClick={()=>setDisplay('fields')}>Fields</button>
   <button type="button" aria-pressed={display==='raw'} className={display==='raw'?'active':''} onClick={()=>setDisplay('raw')}>Raw JSON</button>
  </div></div>
  {display==='fields'?<div className="factory-field-table-wrap">
    <table className="factory-field-table"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead>
     <tbody>{rows.map(row=><tr key={row.path} data-change={row.kind}>
      <th scope="row" title={row.path}>{row.path}</th>
      <td>{renderValue(row.leftValue)}</td><td>{renderValue(row.rightValue)}</td>
      <td><span className={'factory-field-chip '+row.kind}>{row.kind}</span></td>
     </tr>)}</tbody></table>
    {rows.length===0&&<p className="factory-records-empty">No recorded fields for this stage.</p>}
   </div>:<div className="factory-raw-grid">
    <div className="factory-raw-panel"><div className="factory-raw-panel-head"><span>INPUT / BEFORE</span><button type="button" onClick={()=>navigator.clipboard?.writeText(rawBefore)}>Copy</button></div><pre tabIndex={0}>{rawBefore}</pre></div>
    <div className="factory-raw-panel after"><div className="factory-raw-panel-head"><span>OUTPUT / AFTER</span><button type="button" onClick={()=>navigator.clipboard?.writeText(rawAfter)}>Copy</button></div><pre tabIndex={0}>{rawAfter}</pre></div>
   </div>}
  <p className="factory-records-footnote">Only previously stored metadata is shown. Missing fields are not reconstructed.</p>
 </section>;
}
