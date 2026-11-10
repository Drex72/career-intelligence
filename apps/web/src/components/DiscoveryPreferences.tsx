'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {ciFetch} from '@/lib/api';
import {useResource} from '@/components/useResource';
import {useCareerSession} from '@/components/AuthGate';
import {StateNotice} from '@/components/ResourceTable';

type Preferences={
 daily_target:number;job_families:string[];seniority_levels:string[];
 work_modes:string[];sponsorship:'any'|'confirmed_required';updated_at:string|null;
};
const defaults:Preferences={daily_target:25,job_families:['any'],
 seniority_levels:['any'],work_modes:['any'],sponsorship:'any',updated_at:null};
const families=[['any','All software families'],['backend','Backend'],['frontend','Frontend'],
 ['fullstack','Full-stack'],['platform','Platform / Infrastructure'],
 ['ai_ml','AI / ML'],['security','Security'],['data','Data Engineering']];
const levels=[['any','All levels'],['intern','Internship'],['junior','Junior / Graduate'],
 ['mid','Mid-level'],['senior','Senior'],['staff','Staff / Principal']];
const modes=[['any','Any arrangement'],['remote','Remote'],['hybrid','Hybrid'],['onsite','On-site']];

function ChoiceGroup({label,options,selected,onChange}:{
 label:string,options:string[][],selected:string[],onChange:(v:string[])=>void
}){
 return <fieldset className="guidance-surface">
  <legend><strong>{label}</strong></legend>
  <div className="table-inline-actions" style={{flexWrap:'wrap'}}>
   {options.map(([value,text])=><label key={value} className="table-action" style={{cursor:'pointer'}}>
    <input type="checkbox" checked={selected.includes(value)}
      onChange={e=>{
       if(value==='any'){onChange(['any']);return;}
       const previous=selected.filter(v=>v!=='any'&&v!==value);
       const next=e.target.checked?[...previous,value]:previous;
       onChange(next.length?next:['any']);
      }}/> {text}
   </label>)}
  </div>
 </fieldset>;
}

export function DiscoveryPreferences(){
 const session=useCareerSession();
 const resource=useResource<{preferences:Preferences}>('preferences');
 const [value,setValue]=useState<Preferences>(defaults);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 useEffect(()=>{if(resource.data?.preferences)setValue(resource.data.preferences);},[resource.data]);
 async function save(event:FormEvent){
  event.preventDefault();setSaving(true);setError('');setMessage('');
  try{
   const result=await ciFetch<{saved:boolean,note:string}>('preferences',session,{
    method:'POST',body:JSON.stringify({
     daily_target:value.daily_target,job_families:value.job_families,
     seniority_levels:value.seniority_levels,work_modes:value.work_modes,
     sponsorship:value.sponsorship
    })
   });
   if(result.saved){setMessage(result.note);resource.reload();}
  }catch(e){setError(e instanceof Error?e.message:'Could not save discovery settings');}
  finally{setSaving(false);}
 }
 return <section className="workspace-surface" aria-label="Discovery preferences">
  <div className="section-title"><div><h2>Discovery preferences</h2>
   <p className="muted">Set the daily recommendation target and what qualifies. Only future batches use new settings.</p>
  </div></div>
  <StateNotice loading={resource.loading} error={resource.error} retry={resource.reload}/>
  <form onSubmit={e=>void save(e)}>
   <label htmlFor="ci-daily-target"><strong>Companies per day: {value.daily_target}</strong></label>
   <input id="ci-daily-target" type="range" min={1} max={100} step={1}
      value={value.daily_target} onChange={e=>setValue(v=>({...v,daily_target:Number(e.target.value)}))}/>
   <p className="muted">This is a maximum, not a promised count. Employers must have current, source-backed Nigeria hiring eligibility.</p>
   <ChoiceGroup label="Job families" options={families} selected={value.job_families}
     onChange={job_families=>setValue(v=>({...v,job_families}))}/>
   <ChoiceGroup label="Seniority levels" options={levels} selected={value.seniority_levels}
     onChange={seniority_levels=>setValue(v=>({...v,seniority_levels}))}/>
   <ChoiceGroup label="Work arrangement" options={modes} selected={value.work_modes}
     onChange={work_modes=>setValue(v=>({...v,work_modes}))}/>
   <label htmlFor="ci-visa"><strong>Visa sponsorship</strong></label>
   <select id="ci-visa" value={value.sponsorship}
     onChange={e=>setValue(v=>({...v,sponsorship:e.target.value as Preferences['sponsorship']}))}>
     <option value="any">No sponsorship filter</option>
     <option value="confirmed_required">Require verified employer sponsorship evidence</option>
   </select>
   <p className="muted">Unknown remote/on-site arrangements or visa policies are excluded when you choose a restrictive setting. Sponsorship is never inferred from a generic “remote” label.</p>
   <div className="table-inline-actions">
    <button type="submit" className="button-primary" disabled={saving||resource.loading}>{saving?'Saving…':'Save preferences'}</button>
   </div>
   {message&&<p role="status">{message}</p>}
   {error&&<p role="alert" className="error-message">{error}</p>}
  </form>
 </section>;
}
