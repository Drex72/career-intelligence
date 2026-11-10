'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

const SessionContext=createContext<Session|null>(null);
export function useCareerSession(): Session {
  const current=useContext(SessionContext);
  if (!current) throw new Error('Authentication required');
  return current;
}

export function AuthGate({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null|undefined>(undefined);
  const [error,setError]=useState<string|null>(null);
  const router=useRouter();
  useEffect(()=>{
    let active=true;
    try {
      const client=getSupabase();
      client.auth.getSession().then(({data,error})=>{
        if (!active) return;
        if(error){setError(error.message);setSession(null);return;}
        setSession(data.session);
        if(!data.session)router.replace('/login');
      });
      const {data:{subscription}}=client.auth.onAuthStateChange((_event,current)=>{
        if (!active)return;
        setSession(current);
        if(!current)router.replace('/login');
      });
      return ()=>{active=false;subscription.unsubscribe();};
    } catch(err){setError(err instanceof Error?err.message:'Unable to initialize authentication');setSession(null);}
    return ()=>{active=false;};
  },[router]);
  if(error) return <main className="center-screen"><section className="panel"><h2>Authentication unavailable</h2><p className="muted">{error}</p></section></main>;
  if(!session) return <main className="center-screen"><span className="muted">Checking your session…</span></main>;
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
