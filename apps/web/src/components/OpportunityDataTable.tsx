'use client';

import {useMemo,useState} from 'react';
import {flexRender,getCoreRowModel,getPaginationRowModel,getSortedRowModel,useReactTable,type ColumnDef,type SortingState} from '@tanstack/react-table';
import {Badge,Button,Flex} from '@radix-ui/themes';
import {Status} from '@/components/ResourceTable';
import {BlankSlate} from '@/components/WorkspaceUI';
import {safeDateLabel} from '@/lib/data.mjs';

export type OpportunityJob={
 id:string;company_name:string;title:string;published_at:string|null;
 eligibility:string|null;eligibility_expired?:boolean;eligibility_reason?:string|null;
 match_score:number|null;apply_url:string|null;source?:string;source_url?:string|null;
};

export function OpportunityDataTable({jobs,onInspect,selectedId,empty}:{jobs:OpportunityJob[];onInspect:(id:string)=>void;selectedId:string|null;empty:string}){
 const [sorting,setSorting]=useState<SortingState>([{id:'published',desc:true}]);
 const columns=useMemo<ColumnDef<OpportunityJob>[]>(()=>[
   {id:'role',header:'Position',accessorFn:r=>r.title,cell:ctx=>{
      const r=ctx.row.original;
      return <div className="job-identity"><span className="company-avatar" aria-hidden="true">{r.company_name?.charAt(0).toUpperCase()||'?'}</span>
      <div><strong>{r.title}</strong><span>{r.company_name}</span></div></div>;
   }},
   {id:'eligibility',header:'Eligibility',accessorFn:r=>r.eligibility||'unverified',cell:ctx=>{
      const r=ctx.row.original;
      return <div className="eligibility-cell"><Status value={r.eligibility}/>
        {r.eligibility_expired&&<Badge color="amber" variant="soft">Expired</Badge>}
        {r.eligibility_reason&&<span className="eligibility-reason">{r.eligibility_reason}</span>}
      </div>;
   }},
   {id:'match',header:'Match',accessorFn:r=>r.match_score??-1,cell:ctx=>{
      const s=ctx.row.original.match_score;
      return <span className="score-value">{typeof s==='number'&&Number.isFinite(s)&&s>0?Math.round(s)+'%':'Not scored'}</span>;
   }},
   {id:'source',header:'Source',accessorFn:r=>r.source||'',cell:ctx=>{
      const r=ctx.row.original;
      const label=r.source==='remotive'?'Remotive':r.source==='himalayas'?'Himalayas':r.source||'Unspecified';
      return r.source_url?.startsWith('https://')?<a href={r.source_url} target="_blank" rel="noopener noreferrer" className="table-action">{label} ↗</a>:<span className="muted">{label}</span>;
   }},
   {id:'published',header:'Posted',accessorFn:r=>r.published_at?Date.parse(r.published_at)||0:0,
    cell:ctx=><span className="muted">{safeDateLabel(ctx.row.original.published_at)}</span>},
   {id:'actions',header:'Actions',enableSorting:false,cell:ctx=>{
      const r=ctx.row.original;
      return <Flex gap="2" align="center" wrap="wrap">
        <Button type="button" color="violet" variant={selectedId===r.id?'solid':'soft'} size="2" onClick={()=>onInspect(r.id)} aria-label={'Review evidence for '+r.title+' at '+r.company_name}>Evidence</Button>
        {r.apply_url?.startsWith('https://')?<a className="table-action" href={r.apply_url} target="_blank" rel="noopener noreferrer" aria-label={'Open listing for '+r.title}>Listing ↗</a>:<span className="muted">No link</span>}
      </Flex>;
   }},
 ],[onInspect,selectedId]);
 const table=useReactTable({data:jobs,columns,state:{sorting},onSortingChange:setSorting,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getPaginationRowModel:getPaginationRowModel(),initialState:{pagination:{pageSize:15}}});
 if(jobs.length===0)return <BlankSlate title="No matching opportunities" description={empty}/>;
 return <div className="data-grid-shell">
   <div className="table-scroll" role="region" aria-label="Opportunities sortable table" tabIndex={0}>
    <table className="modern-data-table">
      <thead>{table.getHeaderGroups().map(group=><tr key={group.id}>{group.headers.map(header=><th scope="col" key={header.id} aria-sort={header.column.getIsSorted()==='asc'?'ascending':header.column.getIsSorted()==='desc'?'descending':'none'}>
        {header.isPlaceholder?null:header.column.getCanSort()?
          <button className="column-sort-button" type="button" onClick={header.column.getToggleSortingHandler()}>
            {flexRender(header.column.columnDef.header,header.getContext())}<span aria-hidden="true">{header.column.getIsSorted()==='asc'?'↑':header.column.getIsSorted()==='desc'?'↓':'↕'}</span>
          </button>:flexRender(header.column.columnDef.header,header.getContext())}
      </th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row=><tr key={row.id}>{row.getVisibleCells().map(cell=><td key={cell.id}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody>
    </table>
   </div>
   <div className="data-grid-footer">
     <span>{jobs.length} matching roles · Page {table.getState().pagination.pageIndex+1} of {table.getPageCount()}</span>
     <Flex align="center" gap="2">
       <Button type="button" variant="outline" color="gray" size="2" disabled={!table.getCanPreviousPage()} onClick={()=>table.previousPage()}>Previous</Button>
       <Button type="button" variant="outline" color="gray" size="2" disabled={!table.getCanNextPage()} onClick={()=>table.nextPage()}>Next</Button>
     </Flex>
   </div>
 </div>;
}
