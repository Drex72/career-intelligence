'use client';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {ciFetch} from '@/lib/api';
import {useCareerSession} from '@/components/AuthGate';

export type Target={applicant_country:string;employer_country:string|null;role_keywords:string[]};

function countryOptions(){
  const names=new Intl.DisplayNames(['en'],{type:'region'});
  const out:{code:string;name:string}[]=[];
  for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
    const code=String.fromCharCode(a,b);
    let name:string|undefined;
    try{name=names.of(code);}catch{continue;}
    if(name&&name!==code&&!/unknown/i.test(name))out.push({code,name});
  }
  return out.sort((x,y)=>x.name.localeCompare(y.name));
}

/** Where you live, which employer country you want (optional), and which roles. */
export function TargetSettings({target,onSaved}:{target:Target|null;onSaved:()=>void}){
  const session=useCareerSession();
  const countries=useMemo(countryOptions,[]);
  const [applicant,setApplicant]=useState('NG');
  const [employer,setEmployer]=useState('');
  const [keywords,setKeywords]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    if(!target)return;
    setApplicant(target.applicant_country);
    setEmployer(target.employer_country||'');
    setKeywords(target.role_keywords.join(', '));
  },[target]);
  async function save(event:FormEvent){
    event.preventDefault();setSaving(true);setError('');setMessage('');
    const role_keywords=keywords.split(',').map(k=>k.trim()).filter(Boolean);
    if(role_keywords.length>8||role_keywords.some(k=>!/^[A-Za-z0-9 +#./-]{2,60}$/.test(k))){
      setSaving(false);setError('Use up to 8 role keywords, 2–60 letters, numbers or + # . / - each.');return;
    }
    try{
      const result=await ciFetch<{saved:boolean;note:string}>('preferences/target',session,{
        method:'POST',body:JSON.stringify({applicant_country:applicant,
          employer_country:employer||null,role_keywords})});
      if(result.saved){setMessage(result.note);onSaved();}
    }catch(e){setError(e instanceof Error?e.message:'Could not save target');}
    finally{setSaving(false);}
  }
  return <form onSubmit={e=>void save(e)} className="guidance-surface" aria-label="Country and role target">
    <p><strong>Who and what to search for</strong></p>
    <label htmlFor="ci-applicant-country"><strong>I live in</strong></label>
    <select id="ci-applicant-country" value={applicant} onChange={e=>setApplicant(e.target.value)}>
      {countries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
    <p className="muted">Jobs qualify when they are open worldwide or list this country.</p>
    <label htmlFor="ci-employer-country"><strong>Employer based in</strong></label>
    <select id="ci-employer-country" value={employer} onChange={e=>setEmployer(e.target.value)}>
      <option value="">Any country</option>
      {countries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
    <p className="muted">Optional. When set, a job only qualifies once the employer’s country is confirmed from its own website — few employers have that yet, so this setting sharply reduces results.</p>
    <label htmlFor="ci-role-keywords"><strong>Role keywords</strong></label>
    <input id="ci-role-keywords" type="text" value={keywords} maxLength={500}
      placeholder="e.g. backend engineer, platform, python"
      onChange={e=>setKeywords(e.target.value)}/>
    <p className="muted">Comma separated, up to 8. Leave empty for software engineering roles in general. The first 4 are also used as job-board searches.</p>
    <div className="table-inline-actions">
      <button type="submit" className="button-primary" disabled={saving}>{saving?'Saving…':'Save target'}</button>
    </div>
    {message&&<p role="status">{message}</p>}
    {error&&<p role="alert" className="error-message">{error}</p>}
  </form>;
}
