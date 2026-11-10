'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
export default function Login(){
  const router=useRouter();const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false);const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    const check=async()=>{
      try {
        const supabase=getSupabase();
        const {data}=await supabase.auth.getSession();
        if (!data.session) return;
        const response=await fetch('/api/ci/metrics',{
          headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store'});
        if (!active) return;
        if (response.ok) router.replace('/');
        else if (response.status===403) setError('This Google account is not authorized for the Career Intelligence workspace.');
        else if (response.status>=500) setError('The private workspace is temporarily unavailable.');
      } catch { if(active) setError('Could not verify your current session.'); }
    };
    void check();
    return ()=>{active=false;};
  },[router]);
  async function signInGoogle(){
    setLoading(true);setError(null);
    try {
      const supabase=getSupabase();
      const {error:oauthError}=await supabase.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo:window.location.origin+'/login'},
      });
      if(oauthError) throw oauthError;
    }catch(err){setError(err instanceof Error?err.message:'Unable to start Google sign-in');setLoading(false);}
  }
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
  return <main className="login-screen"><div className="login-layout"><aside className="login-story"><div className="story-wordmark"><img src="/brand-mark.svg" alt="" className="story-brand-logo" width={40} height={40}/><span>Career Intelligence</span></div><div className="story-main"><p className="story-label">A MORE INTENTIONAL JOB SEARCH</p><h2>Make your next move with clarity.</h2><p>Research opportunities, understand who can hire you, and keep every application and conversation in one thoughtful workspace.</p></div><div className="story-footer"><span className="story-footer-dot" aria-hidden="true"/>Evidence before assumptions. You stay in control.</div></aside><div className="login-card">
    <img src="/brand-mark.svg" className="login-brand-logo" width={46} height={46} alt="" /><p className="eyebrow">PRIVATE WORKSPACE</p>
    <h1>Career Intelligence</h1><p className="muted">Sign in with your authorized Groundwork Supabase account.</p>
    <form onSubmit={submit} className="login-form">
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {error&&<div className="error-message" role="alert">{error}</div>}
      <button type="submit" disabled={loading}>{loading?'Verifying…':'Sign in'}</button>
    </form>
    <button type="button" className="outline-button" disabled={loading} onClick={signInGoogle}>Continue with Google</button>
    <small className="muted">Google sign-in uses the same owner-only access checks · No public registrations · No automatic email sending</small>
  </div></div></main>;
}
