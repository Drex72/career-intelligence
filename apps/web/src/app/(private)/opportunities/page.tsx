'use client';

import {useRef,useState} from 'react';
import {Button,Card,Flex,SegmentedControl,TextField} from '@radix-ui/themes';
import {useResource} from '@/components/useResource';
import {useCareerSession} from '@/components/AuthGate';
import {ciFetch} from '@/lib/api';
import {StateNotice} from '@/components/ResourceTable';
import {Notice,PageHeading,SectionHeading} from '@/components/WorkspaceUI';
import {filterOpportunities} from '@/lib/opportunity-filters.mjs';
import {OpportunityDataTable,type OpportunityJob} from '@/components/OpportunityDataTable';
import {OpportunityEvidenceDialog,type EvidenceBundle} from '@/components/OpportunityEvidenceDialog';

type Filter='all'|'verified_eligible'|'likely_eligible'|'unverified'|'ineligible';
const filterOptions:{id:Filter;label:string}[]=[
 {id:'all',label:'All'},
 {id:'verified_eligible',label:'Verified'},
 {id:'likely_eligible',label:'Likely'},
 {id:'unverified',label:'Needs verification'},
 {id:'ineligible',label:'Ineligible'}
];
export default function Opportunities(){
  const {data,error,loading,reload}=useResource<{jobs:OpportunityJob[]}>('jobs');
  const session=useCareerSession();
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<Filter>('all');
  const [checking,setChecking]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [evidence,setEvidence]=useState<EvidenceBundle|null>(null);
  const [evidenceError,setEvidenceError]=useState('');
  const [loadingEvidence,setLoadingEvidence]=useState(false);
  const [notice,setNotice]=useState('');
  const [scanError,setScanError]=useState('');
  const requestNumber=useRef(0);

  async function checkSource(){
    setChecking(true);setScanError('');setNotice('');
    try{
      const result=await ciFetch<{imported:number;skipped:number;source:string;note:string}>('discover',session,{method:'POST'});
      setNotice(result.imported+' public postings stored from '+result.source+'. '+result.note);
      reload();
    }catch(err){setScanError(err instanceof Error?err.message:'Unable to check public sources');}
    finally{setChecking(false);}
  }

  function closeEvidence(){
    requestNumber.current+=1;
    setSelected(null);setEvidence(null);setLoadingEvidence(false);setEvidenceError('');
  }
  async function inspect(jobId:string){
    if(selected===jobId){closeEvidence();return;}
    const request=++requestNumber.current;
    setSelected(jobId);setEvidence(null);setEvidenceError('');setLoadingEvidence(true);
    try{
      const result=await ciFetch<EvidenceBundle>('jobs/'+jobId+'/evidence',session);
      if(request===requestNumber.current)setEvidence(result);
    }catch(err){
      if(request===requestNumber.current)setEvidenceError(err instanceof Error?err.message:'Evidence unavailable');
    }finally{
      if(request===requestNumber.current)setLoadingEvidence(false);
    }
  }

  const jobs=data?.jobs||[];
  const filtered=filterOpportunities(jobs,search,filter) as OpportunityJob[];
  const selectedJob=jobs.find(j=>j.id===selected);
  const eligibilityCounts={
    verified:jobs.filter(j=>j.eligibility==='verified_eligible'&&!j.eligibility_expired).length,
    research:jobs.filter(j=>!j.eligibility||!['verified_eligible','likely_eligible','ineligible'].includes(j.eligibility)||j.eligibility_expired).length
  };

  return <div className="opportunity-page">
    <PageHeading title="Find your next opportunity." meta="DISCOVER / VERIFY" description="Explore public roles, then inspect evidence before trusting hiring eligibility."
      action={<Button size="3" disabled={checking} onClick={()=>void checkSource()}>{checking?'Checking…':'Check public jobs'}</Button>}/>
    {notice&&<Notice tone="success">{notice}</Notice>}
    {scanError&&<Notice tone="danger" title="Source check failed">{scanError}</Notice>}
    <div className="opportunity-glance" aria-label="Opportunity summary">
      <div><span>Discovered listings</span><strong>{loading?'—':jobs.length}</strong></div>
      <div><span>Verified eligible</span><strong>{loading?'—':eligibilityCounts.verified}</strong></div>
      <div><span>Awaiting research or expired</span><strong>{loading?'—':eligibilityCounts.research}</strong></div>
    </div>
    <Card className="workspace-surface opportunity-surface" variant="surface">
      <SectionHeading title="Opportunity explorer" description="Sort records by role, assessment, match, source or date. All values come from public-source records."
        action={<span className="result-count" aria-live="polite">{filtered.length} of {jobs.length} roles</span>}/>
      <Flex direction="column" gap="3" className="explorer-controls-v2">
        <label className="search-field-v2"><span className="sr-only">Search by company or role</span>
          <TextField.Root size="3" placeholder="Search company or job title…" type="search" value={search} onChange={event=>setSearch(event.target.value)} />
        </label>
        <div className="filter-scroll" role="group" aria-label="Eligibility filter">
          <SegmentedControl.Root size="2" value={filter} onValueChange={value=>setFilter(value as Filter)}>
            {filterOptions.map(f=><SegmentedControl.Item key={f.id} value={f.id}>{f.label}</SegmentedControl.Item>)}
          </SegmentedControl.Root>
        </div>
      </Flex>
      <StateNotice loading={loading} error={error} retry={reload}/>
      {!loading&&!error&&<OpportunityDataTable jobs={filtered} selectedId={selected} onInspect={id=>void inspect(id)}
        empty={search||filter!=='all'?'No positions match the active search and eligibility filter.':'No public jobs have been imported. Use Check public jobs to retrieve listings.'}/>}
    </Card>
    <OpportunityEvidenceDialog open={Boolean(selected)} onClose={closeEvidence} company={selectedJob?.company_name} title={selectedJob?.title}
      bundle={evidence} loading={loadingEvidence} error={evidenceError}/>
  </div>;
}
