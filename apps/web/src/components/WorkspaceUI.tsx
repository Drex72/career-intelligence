import type {ReactNode} from 'react';
import Link from 'next/link';

export function PageHeading({title,description,action,meta}:{title:string;description:string;action?:ReactNode;meta?:string}){
  return <header className="product-heading"><div className="product-heading-copy">{meta&&<p className="page-context">{meta}</p>}<h1>{title}</h1><p>{description}</p></div>{action&&<div className="heading-actions">{action}</div>}</header>;
}
export function SectionHeading({title,description,action}:{title:string;description?:string;action?:ReactNode}){
  return <div className="section-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action&&<div className="section-actions">{action}</div>}</div>;
}
export function MetricTile({label,value,hint}:{label:string;value:string|number;hint?:string}){
  return <article className="metric-tile"><span className="metric-tile-label">{label}</span><div className="metric-tile-number">{value}</div>{hint&&<span className="metric-tile-hint">{hint}</span>}</article>;
}
export function BlankSlate({title,description,action}:{title:string;description?:string;action?:ReactNode}){
  return <div className="blank-slate"><div className="blank-slate-art" aria-hidden="true"><span/><span/><span/></div><h3>{title}</h3>{description&&<p>{description}</p>}{action&&<div className="blank-slate-action">{action}</div>}</div>;
}
export function Notice({tone='info',title,children}:{tone?:'info'|'success'|'danger';title?:string;children:ReactNode}){
  return <div className={'notice notice-'+tone} role={tone==='danger'?'alert':'status'}><span className="notice-mark" aria-hidden="true">{tone==='success'?'✓':tone==='danger'?'!':'i'}</span><div>{title&&<strong>{title}</strong>}<p>{children}</p></div></div>;
}
export function InsetLink({href,children}:{href:string;children:ReactNode}){
  return <Link href={href} className="inset-link">{children}<span aria-hidden="true">→</span></Link>;
}
