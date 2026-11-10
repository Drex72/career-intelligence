'use client';

import {Badge,Button,Dialog,Flex,Separator,Text} from '@radix-ui/themes';
import {StateNotice,Status} from '@/components/ResourceTable';
import {safeDateLabel} from '@/lib/data.mjs';

export type EvidenceBundle={
 job:{id:string;title:string};
 sources:{source_name:string;source_url:string;retrieved_at:string}[];
 evidence:{source_url:string;source_kind:string;excerpt:string;observed_at:string;claim:string}[];
 assessments:{status:string;confidence:number;assessed_at:string;reasons:unknown;contradictions:unknown}[];
 note:string;
};

export function OpportunityEvidenceDialog({open,onClose,company,title,bundle,loading,error}:{
 open:boolean;onClose:()=>void;company?:string;title?:string;bundle:EvidenceBundle|null;loading:boolean;error:string;
}){
 return <Dialog.Root open={open} onOpenChange={isOpen=>{if(!isOpen)onClose();}}>
   <Dialog.Content maxWidth="760px" className="evidence-dialog" aria-describedby="evidence-dialog-summary">
     <Flex align="start" justify="between" gap="4">
       <div><Text size="1" weight="bold" className="page-context">ROLE-SPECIFIC EVIDENCE</Text>
         <Dialog.Title size="5" mb="1">Hiring eligibility</Dialog.Title>
         <Dialog.Description id="evidence-dialog-summary">{company||'Employer'} · {title||'Selected opportunity'}</Dialog.Description>
       </div>
       <Dialog.Close><Button type="button" color="gray" variant="soft">Close</Button></Dialog.Close>
     </Flex>
     <Separator my="4" size="4"/>
     <StateNotice loading={loading} error={error||null}/>
     {!loading&&!error&&bundle&&<div className="evidence-dialog-body">
       {bundle.note&&<div className="evidence-intro"><strong>Research note</strong><p>{bundle.note}</p></div>}
       <section><h3>Eligibility assessments</h3>
         {bundle.assessments.length===0?<p className="muted">No assessment recorded. Eligibility is not verified.</p>:
         <ul className="evidence-list">{bundle.assessments.map((a,i)=><li key={i}>
           <Flex align="center" wrap="wrap" gap="2"><Status value={a.status}/><Badge color="gray" variant="soft">{Math.round(a.confidence*100)}% confidence</Badge><Text size="1" color="gray">{safeDateLabel(a.assessed_at)}</Text></Flex>
         </li>)}</ul>}
       </section>
       <section><h3>Public research sources</h3>
         {bundle.sources.length===0?<p className="muted">No sourced references are available for this role.</p>:
         <ul className="evidence-list">{bundle.sources.map((s,i)=><li key={i}><strong>{s.source_name}</strong>
          <Text color="gray" size="1">Retrieved {safeDateLabel(s.retrieved_at)}</Text>
          {s.source_url?.startsWith('https://')?<a href={s.source_url} target="_blank" rel="noopener noreferrer" className="table-action">Inspect original source ↗</a>:<Text size="1" color="gray">Source link unavailable</Text>}
         </li>)}</ul>}
       </section>
       <section><h3>Supporting claims</h3>
         {bundle.evidence.length===0?<p className="muted">No employer evidence collected.</p>:
         <ul className="evidence-list">{bundle.evidence.map((e,i)=><li key={i}>
           <strong>{e.claim}</strong><p>{e.excerpt?.slice(0,480)}</p>
           <Flex gap="3" align="center" wrap="wrap"><Text size="1" color="gray">{e.source_kind} · {safeDateLabel(e.observed_at)}</Text>
            {e.source_url?.startsWith('https://')&&<a href={e.source_url} target="_blank" rel="noopener noreferrer" className="table-action">View claim source ↗</a>}
           </Flex>
         </li>)}</ul>}
       </section>
     </div>}
   </Dialog.Content>
 </Dialog.Root>;
}
