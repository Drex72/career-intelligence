'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
const links=[
  ['/', 'Overview','▦'],['/opportunities','Opportunities','◎'],
  ['/applications','Applications','▣'],['/people','People intelligence','♧'],
  ['/knowledge','Knowledge base','◇'],['/outreach','Outreach','✉'],
  ['/operations','Agent operations','◷'],
];
export function Navigation(){
  const pathname=usePathname();const router=useRouter();
  async function signOut(){await getSupabase().auth.signOut();router.replace('/login');}
  return <aside className="sidebar">
    <Link href="/" className="brand"><span className="brand-mark">C<span>I</span></span>
      <span>Career <strong>Intelligence</strong><small>Personal operations</small></span></Link>
    <p className="side-caption">WORKSPACE</p>
    <nav className="nav-list" aria-label="Main navigation">
      {links.map(([href,label,symbol])=><Link key={href} href={href}
        className={'nav-link '+(pathname===href?'active':'')} aria-current={pathname===href?'page':undefined}>
          <span className="nav-symbol">{symbol}</span>{label}</Link>)}
    </nav>
    <div className="sidebar-footer"><div className="privacy-dot"/>
      <span>Private workspace</span><button type="button" onClick={signOut}>Sign out</button></div>
  </aside>;
}
