'use client';
import {useMemo,useState} from 'react';
import {useResource} from '@/components/useResource';
import {StateNotice,Status} from '@/components/ResourceTable';
import {PageHeading,SectionHeading,BlankSlate} from '@/components/WorkspaceUI';
type Person={id:string;name:string;current_title:string;company_name:string;profile_url:string;identity_verified:boolean};
export default function People(){
  const {data,error,loading,reload}=useResource<{contacts:Person[]}>('people');
  const [search,setSearch]=useState('');
  const people=data?.contacts||[];
  const filtered=useMemo(()=>people.filter(p=>(p.name+' '+p.current_title+' '+p.company_name).toLowerCase().includes(search.trim().toLowerCase())),[people,search]);
  return <div className="people-page">
    <PageHeading title="People intelligence" meta="RESEARCH / PEOPLE" description="The people behind the companies you're exploring, with sources you can actually verify."/>
    <section className="workspace-surface">
      <SectionHeading title="Sourced professionals" description="Contact details appear only when backed by public research." action={<span className="result-count">{filtered.length} contacts</span>}/>
      <label className="search-control people-search"><span className="sr-only">Search people and companies</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search by name, company or role" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <StateNotice loading={loading} error={error} retry={reload}/>
      {!loading&&!error&&(filtered.length?<div className="contact-grid">{filtered.map(p=><article className="contact-card" key={p.id}><div className="contact-card-top"><span className="contact-monogram" aria-hidden="true">{p.name.trim().charAt(0).toUpperCase()}</span><Status value={p.identity_verified?'verified':'unverified'}/></div><h3>{p.name}</h3><p className="contact-title">{p.current_title}</p><p className="contact-company">{p.company_name}</p>{p.profile_url?.startsWith('https://')?<a className="contact-link" href={p.profile_url} target="_blank" rel="noopener noreferrer">View source profile <span aria-hidden="true">↗</span></a>:<span className="muted">No valid public profile link</span>}</article>)}</div>:<BlankSlate title={search?'No matching people':'No sourced contacts yet'} description={search?'Try searching for a different name, company or role.':'Professionals are researched only after relevant, verified opportunities are identified. No identities are invented.'}/>)}
    </section>
  </div>;
}
