import type {ReactNode} from 'react';
import Link from 'next/link';
import {Card,Callout} from '@radix-ui/themes';

export function PageHeading({title,description,action,meta}:{title:string;description:string;action?:ReactNode;meta?:string}){
  return <header className="product-heading"><div className="product-heading-copy">{meta&&<p className="page-context">{meta}</p>}<h1>{title}</h1><p>{description}</p></div>{action&&<div className="heading-actions">{action}</div>}</header>;
}
export function SectionHeading({title,description,action}:{title:string;description?:string;action?:ReactNode}){
  return <div className="section-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action&&<div className="section-actions">{action}</div>}</div>;
}
export function MetricTile({label,value,hint}:{label:string;value:string|number;hint?:string}){
  return <Card className="metric-tile" variant="surface"><span className="metric-tile-label">{label}</span><div className="metric-tile-number">{value}</div>{hint&&<span className="metric-tile-hint">{hint}</span>}</Card>;
}
export function BlankSlate({title,description,action}:{title:string;description?:string;action?:ReactNode}){
  return <div className="blank-slate"><div className="blank-slate-art" aria-hidden="true"><span/><span/><span/></div><h3>{title}</h3>{description&&<p>{description}</p>}{action&&<div className="blank-slate-action">{action}</div>}</div>;
}
export function Notice({tone='info',title,children}:{tone?:'info'|'success'|'danger';title?:string;children:ReactNode}){
  return <Callout.Root color={tone==='success'?'green':tone==='danger'?'red':'violet'} variant="soft" className={'notice notice-'+tone} role={tone==='danger'?'alert':'status'}><Callout.Icon>{tone==='success'?'✓':tone==='danger'?'!':'i'}</Callout.Icon><Callout.Text>{title&&<strong>{title}</strong>}<span>{children}</span></Callout.Text></Callout.Root>;
}
export function InsetLink({href,children}:{href:string;children:ReactNode}){
  return <Link href={href} className="inset-link">{children}<span aria-hidden="true">→</span></Link>;
}
