import type { Session } from '@supabase/supabase-js';
export async function ciFetch<T>(path: string, session: Session, init?: RequestInit): Promise<T> {
  const response = await fetch('/api/ci/' + path.replace(/^\/+/, ''), {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers || {}),
      Authorization: 'Bearer ' + session.access_token,
      ...(init?.body ? {'Content-Type':'application/json'} : {}),
    },
  });
  if (!response.ok) {
    let detail='Request failed ('+response.status+')';
    try { const body=await response.json(); detail=String(body.detail || body.error || detail); } catch {}
    throw new Error(detail);
  }
  return await response.json() as T;
}
