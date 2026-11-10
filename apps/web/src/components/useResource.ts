'use client';
import { useCallback, useEffect, useState } from 'react';
import { ciFetch } from '@/lib/api';
import { useCareerSession } from './AuthGate';

export function useResource<T>(path:string){
  const session=useCareerSession();
  const [data,setData]=useState<T|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [revision,setRevision]=useState(0);
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{
    const ctl=new AbortController();
    setLoading(true);setError(null);
    ciFetch<T>(path,session,{signal:ctl.signal}).then(v=>{
      if(!ctl.signal.aborted)setData(v);
    }).catch(e=>{if(!ctl.signal.aborted)setError(e instanceof Error?e.message:String(e));})
      .finally(()=>{if(!ctl.signal.aborted)setLoading(false);});
    return ()=>ctl.abort();
  },[path,session,revision]);
  return {data,error,loading,reload};
}
