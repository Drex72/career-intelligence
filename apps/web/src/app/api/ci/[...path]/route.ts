import { safePath } from '@/lib/ci-routes.mjs';
import { resolveBackend } from '@/lib/backend-base.mjs';
import { NextRequest, NextResponse } from 'next/server';

async function proxy(req: NextRequest, params: Promise<{path: string[]}>, method: 'GET'|'POST') {
  const {path:parts}=await params;
  const path=safePath(parts,method);
  if (!path) return NextResponse.json({error:'Unsupported API path'},{status:404});
  const token=req.headers.get('Authorization') || '';
  if (!token.startsWith('Bearer ') || token.length>8200)
    return NextResponse.json({error:'Authentication required'},{status:401});
  const backend=resolveBackend(process.env.CI_BACKEND_URL, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV);
  if (!backend)
    return NextResponse.json({error:'Backend not configured'},{status:503});
  const original=new URL(req.url);
  const url=backend+'/api/ci/'+path+(method==='GET' ? original.search : '');
  try {
    const result=await fetch(url, {
      method,
      headers: {'Authorization':token,...(method==='POST'?{'Content-Type':'application/json'}:{})},
      body: method==='POST' ? await req.text() : undefined,
      cache:'no-store',
      redirect:'error',
      signal:AbortSignal.timeout(12000),
    });
    return new NextResponse(await result.text(),{
      status:result.status,
      headers:{'Content-Type':'application/json','Cache-Control':'no-store, max-age=0'},
    });
  } catch {
    return NextResponse.json({error:'Career Intelligence backend unavailable'},
      {status:502,headers:{'Cache-Control':'no-store'}});
  }
}
export async function GET(req: NextRequest,{params}:{params:Promise<{path:string[]}>}) {
  return proxy(req,params,'GET');
}
export async function POST(req: NextRequest,{params}:{params:Promise<{path:string[]}>}) {
  return proxy(req,params,'POST');
}
