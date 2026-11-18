'use client';
import {useEffect,useMemo,useState,type FormEvent,type ReactNode} from 'react';
import {ciFetch} from '@/lib/api';
import {useResource} from '@/components/useResource';
import {useCareerSession} from '@/components/AuthGate';
import {StateNotice} from '@/components/ResourceTable';
import {Notice} from '@/components/WorkspaceUI';
import {countryOptions,countryName,parseKeywords,keywordError,targetSummary} from '@/lib/targeting.mjs';
import {safeDateLabel} from '@/lib/data.mjs';

export type Target={applicant_country:string;employer_country:string|null;role_keywords:string[]};
type Preferences={
 daily_target:number;job_families:string[];seniority_levels:string[];
 work_modes:string[];sponsorship:'any'|'confirmed_required';updated_at:string|null;
};
type Form=Omit<Preferences,'updated_at'>&{applicant:string;employer:string;keywords:string};

const families=[['any','Any software role'],['backend','Backend'],['frontend','Frontend'],
 ['fullstack','Full-stack'],['platform','Platform / Infrastructure'],
 ['ai_ml','AI / ML'],['security','Security'],['data','Data engineering']];
const levels=[['any','Any level'],['intern','Internship'],['junior','Junior / Graduate'],
 ['mid','Mid-level'],['senior','Senior'],['staff','Staff / Principal']];
const modes=[['any','Any arrangement'],['remote','Remote'],['hybrid','Hybrid'],['onsite','On-site']];

function toForm(p:Preferences,t:Target|null):Form{
 return {daily_target:p.daily_target,job_families:p.job_families,seniority_levels:p.seniority_levels,
  work_modes:p.work_modes,sponsorship:p.sponsorship,
  applicant:t?.applicant_country??'NG',employer:t?.employer_country??'',keywords:(t?.role_keywords??[]).join(', ')};
}
const fallback:Preferences={daily_target:25,job_families:['any'],seniority_levels:['any'],
 work_modes:['any'],sponsorship:'any',updated_at:null};

function Field({id,label,hint,children}:{id:string;label:string;hint?:ReactNode;children:ReactNode}){
 return <div className="settings-field">
  <label htmlFor={id}>{label}</label>
  {children}
  {hint&&<p className="settings-hint" id={id+'-hint'}>{hint}</p>}
 </div>;
}
function Chips({label,hint,options,selected,onChange}:{
 label:string;hint?:string;options:string[][];selected:string[];onChange:(v:string[])=>void
}){
 return <fieldset className="settings-field settings-chips">
  <legend>{label}</legend>
  <div className="choice-chips">
   {options.map(([value,text])=><label key={value} className={'choice-chip'+(selected.includes(value)?' is-on':'')}>
    <input type="checkbox" checked={selected.includes(value)}
      onChange={e=>{
       if(value==='any'){onChange(['any']);return;}
       const previous=selected.filter(v=>v!=='any'&&v!==value);
       const next=e.target.checked?[...previous,value]:previous;
       onChange(next.length?next:['any']);
      }}/>{text}
   </label>)}
  </div>
  {hint&&<p className="settings-hint">{hint}</p>}
 </fieldset>;
}

/** One form, one save: where you can work, which roles, and how many per day. */
export function DiscoveryPreferences(){
 const session=useCareerSession();
 const resource=useResource<{preferences:Preferences;target:Target|null}>('preferences');
 const countries=useMemo(()=>countryOptions() as {code:string;name:string}[],[]);
 const saved=useMemo(()=>resource.data?toForm(resource.data.preferences??fallback,resource.data.target??null):null,[resource.data]);
 const [form,setForm]=useState<Form|null>(null);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 useEffect(()=>{if(saved)setForm(saved);},[saved]);
 const dirty=!!form&&!!saved&&JSON.stringify(form)!==JSON.stringify(saved);
 const keywords=form?parseKeywords(form.keywords):[];
 const keywordProblem=keywordError(keywords);
 function set<K extends keyof Form>(key:K,value:Form[K]){setForm(f=>f&&{...f,[key]:value});setMessage('');}

 async function save(event:FormEvent){
  event.preventDefault();
  if(!form)return;
  if(keywordProblem){setError(keywordProblem);return;}
  setSaving(true);setError('');setMessage('');
  try{
   await ciFetch('preferences/target',session,{method:'POST',body:JSON.stringify({
    applicant_country:form.applicant,employer_country:form.employer||null,role_keywords:keywords})});
   await ciFetch('preferences',session,{method:'POST',body:JSON.stringify({
    daily_target:form.daily_target,job_families:form.job_families,seniority_levels:form.seniority_levels,
    work_modes:form.work_modes,sponsorship:form.sponsorship})});
   setMessage('Saved. The next search run and the next daily list use these settings.');
   resource.reload();
  }catch(e){setError(e instanceof Error?e.message:'Could not save settings');}
  finally{setSaving(false);}
 }

 const target=resource.data?.target??null;
 return <section className="workspace-surface settings-surface" aria-labelledby="search-settings-heading">
  <div className="current-target">
   <span className="current-target-label">Currently searching for</span>
   <p id="search-settings-heading">{target?targetSummary(target):'Nothing yet. Save the form below to start.'}</p>
   {resource.data?.preferences?.updated_at&&<small>Last saved {safeDateLabel(resource.data.preferences.updated_at)}</small>}
  </div>
  <StateNotice loading={resource.loading} error={resource.error} retry={resource.reload}/>
  {form&&<form onSubmit={e=>void save(e)} className="settings-form" noValidate>
   <section className="settings-group" aria-labelledby="group-location">
    <header><span className="settings-step">1</span><div><h3 id="group-location">Location</h3>
     <p>Jobs qualify when they’re open worldwide or explicitly list the country you live in.</p></div></header>
    <div className="settings-grid">
     <Field id="ci-applicant-country" label="Country you live in"
       hint="Used to search job boards by country and to check each job’s location rules.">
      <select id="ci-applicant-country" aria-describedby="ci-applicant-country-hint" value={form.applicant}
        onChange={e=>set('applicant',e.target.value)}>
       {countries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
     </Field>
     <Field id="ci-employer-country" label="Employer headquarters (optional)"
       hint="Leave as “Any country” unless you only want employers based in one country.">
      <select id="ci-employer-country" aria-describedby="ci-employer-country-hint" value={form.employer}
        onChange={e=>set('employer',e.target.value)}>
       <option value="">Any country (recommended)</option>
       {countries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
     </Field>
    </div>
    {form.employer&&<Notice title={'Only employers confirmed as based in '+countryName(form.employer)}>
      A job only qualifies after the employer’s country is confirmed from its own website. Few employers have that confirmation yet, so this setting can reduce your daily list to zero.
    </Notice>}
   </section>

   <section className="settings-group" aria-labelledby="group-roles">
    <header><span className="settings-step">2</span><div><h3 id="group-roles">Roles</h3>
     <p>Job titles must contain at least one keyword. With no keywords, general software engineering titles are used.</p></div></header>
    <Field id="ci-role-keywords" label="Role keywords"
      hint={<>Separate with commas, up to 8. The first 4 are also used as job-board searches.</>}>
     <input id="ci-role-keywords" type="text" value={form.keywords} maxLength={500} autoComplete="off"
       aria-describedby="ci-role-keywords-hint" aria-invalid={!!keywordProblem}
       placeholder="e.g. backend engineer, platform, python" onChange={e=>set('keywords',e.target.value)}/>
    </Field>
    {keywords.length>0&&<ul className="keyword-preview" aria-label="Keywords that will be saved">
     {keywords.map((k,i)=><li key={k} className={i<4?'is-search':''} title={i<4?'Also searched on job boards':'Title filter only'}>{k}</li>)}
    </ul>}
    {keywordProblem&&<p className="field-error" role="alert">{keywordProblem}</p>}
    <Chips label="Job families" options={families} selected={form.job_families} onChange={v=>set('job_families',v)}/>
    <Chips label="Seniority" options={levels} selected={form.seniority_levels} onChange={v=>set('seniority_levels',v)}/>
   </section>

   <section className="settings-group" aria-labelledby="group-delivery">
    <header><span className="settings-step">3</span><div><h3 id="group-delivery">Daily list</h3>
     <p>One role per employer, never repeated. Built every morning at 07:00 (Lagos time).</p></div></header>
    <Field id="ci-daily-target" label="Maximum recommendations per day"
      hint="An upper limit, not a promise. Only jobs that pass every check are included.">
     <div className="range-row">
      <input id="ci-daily-target" type="range" min={1} max={100} step={1} aria-describedby="ci-daily-target-hint"
        value={form.daily_target} onChange={e=>set('daily_target',Number(e.target.value))}/>
      <output htmlFor="ci-daily-target" className="range-value">{form.daily_target}</output>
     </div>
    </Field>
    <Chips label="Work arrangement" options={modes} selected={form.work_modes} onChange={v=>set('work_modes',v)}
      hint="Jobs with an unknown arrangement are left out when you pick a specific one."/>
    <Field id="ci-visa" label="Visa sponsorship"
      hint="Sponsorship is never assumed from a “remote” label.">
     <select id="ci-visa" aria-describedby="ci-visa-hint" value={form.sponsorship}
       onChange={e=>set('sponsorship',e.target.value as Preferences['sponsorship'])}>
      <option value="any">Don’t filter by sponsorship</option>
      <option value="confirmed_required">Only employers with confirmed sponsorship</option>
     </select>
    </Field>
   </section>

   <div className="settings-footer">
    <span className={'settings-state'+(dirty?' is-dirty':'')} aria-live="polite">
     {saving?'Saving…':dirty?'Unsaved changes':message||'All changes saved'}
    </span>
    <div className="table-inline-actions">
     <button type="button" className="button-secondary" disabled={!dirty||saving} onClick={()=>{setForm(saved);setError('');}}>Discard</button>
     <button type="submit" className="button-primary" disabled={!dirty||saving||!!keywordProblem}>{saving?'Saving…':'Save settings'}</button>
    </div>
   </div>
   {error&&<p role="alert" className="error-message">{error}</p>}
  </form>}
 </section>;
}
