'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
export default function Login(){
  const router=useRouter();const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false);const [error,setError]=useState<string|null>(null);
  async function submit(event:FormEvent){
    event.preventDefault();setLoading(true);setError(null);
    try {
      const supabase=getSupabase();
      const {data,error:authError}=await supabase.auth.signInWithPassword({email,password});
      if(authError||!data.session)throw new Error(authError?.message||'Authentication failed');
      const response=await fetch('/api/ci/metrics',{
        headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store'});
      if(!response.ok){await supabase.auth.signOut();throw new Error(response.status===403?
        'This account is not authorized for the Career Intelligence workspace.':'Unable to verify Career Intelligence access.');}
      router.replace('/');
    }catch(err){setError(err instanceof Error?err.message:'Unable to sign in');}
    finally{setLoading(false);}
  }
  return <main className="login-screen"><div className="login-card">
    <div className="logo-large">CI<span>✦</span></div><p className="eyebrow">PRIVATE WORKSPACE</p>
    <h1>Career Intelligence</h1><p className="muted">Sign in with your authorized Groundwork Supabase account.</p>
    <form onSubmit={submit} className="login-form">
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {error&&<div className="error-message" role="alert">{error}</div>}
      <button type="submit" disabled={loading}>{loading?'Verifying…':'Sign in'}</button>
    </form>
    <small className="muted">No public registrations · No automatic email sending</small>
  </div></main>;
}
