'use client';
import {PageHeading} from '@/components/WorkspaceUI';
import { useResource } from '@/components/useResource';
import { ResourceTable,StateNotice,Status } from '@/components/ResourceTable';
type Person={id:string,name:string,current_title:string,company_name:string,profile_url:string,identity_verified:boolean};
export default function People(){
  const {data,error,loading}=useResource<{contacts:Person[]}>('people');
  return <><PageHeading meta="RESEARCH / PEOPLE" title="People intelligence" description="Research the people behind relevant companies, with source-backed identities rather than guessed contacts."/>
    <section className="workspace-surface"><StateNotice loading={loading} error={error}/>
      {data&&<ResourceTable items={data.contacts} columns={[
        {key:'name',label:'Professional',render:r=><strong>{r.name}</strong>},
        {key:'title',label:'Role',render:r=>r.current_title},
        {key:'company',label:'Company',render:r=>r.company_name},
        {key:'verification',label:'Identity',render:r=><Status value={r.identity_verified?'verified':'unverified'}/>},
        {key:'profile',label:'Profile',render:r=><a href={r.profile_url} className="text-link" target="_blank" rel="noopener noreferrer">Source ↗</a>},
      ]} empty="No sourced contacts found. The system does not invent names or email addresses."/>}</section>
  </>;
}
