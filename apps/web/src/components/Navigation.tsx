'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

type IconName='overview'|'opportunities'|'applications'|'people'|'knowledge'|'outreach'|'conversations'|'operations';
const links:{href:string;label:string;icon:IconName}[]=[
  {href:'/',label:'Overview',icon:'overview'},
  {href:'/opportunities',label:'Opportunities',icon:'opportunities'},
  {href:'/applications',label:'Applications',icon:'applications'},
  {href:'/people',label:'People intelligence',icon:'people'},
  {href:'/knowledge',label:'Knowledge base',icon:'knowledge'},
  {href:'/outreach',label:'Outreach',icon:'outreach'},
  {href:'/conversations',label:'Conversations',icon:'conversations'},
  {href:'/operations',label:'Agent operations',icon:'operations'},
];
const paths:Record<IconName,React.ReactNode>={
  overview:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  opportunities:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6m-3-3h6"/></>,
  applications:<><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 5V3h6v2M8 11h8M8 15h6"/></>,
  people:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/></>,
  knowledge:<><path d="M4 5.5C7 4 10 4 12 6c2-2 5-2 8-.5V19c-3-1.5-6-1.5-8 .5-2-2-5-2-8-.5zM12 6v13.5"/></>,
  outreach:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  conversations:<><path d="M20 11.5a8 8 0 0 1-8 8 9 9 0 0 1-4-.9L4 20l1.4-4A8 8 0 1 1 20 11.5Z"/><path d="M8 11h8M8 14h5"/></>,
  operations:<><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="4"/></>,
};
function NavIcon({name}:{name:IconName}){
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function Navigation(){
  const pathname=usePathname();const router=useRouter();
  async function signOut(){await getSupabase().auth.signOut();router.replace('/login');}
  return <aside className="sidebar">
    <Link href="/" className="brand" aria-label="Career Intelligence home"><span className="brand-mark">C<span>I</span></span>
      <span>Career <strong>Intelligence</strong><small>Personal workspace</small></span></Link>
    <p className="side-caption">WORKSPACE</p>
    <nav className="nav-list" aria-label="Main navigation">
      {links.map(({href,label,icon})=>{
        const active=href==='/'?pathname===href:pathname===href||pathname.startsWith(href+'/');
        return <Link key={href} href={href} className={'nav-link '+(active?'active':'')} aria-current={active?'page':undefined}>
          <span className="nav-symbol"><NavIcon name={icon}/></span><span>{label}</span>
        </Link>;
      })}
    </nav>
    <div className="sidebar-footer"><span className="privacy-dot" aria-hidden="true"/>
      <span>Private workspace</span><button type="button" onClick={()=>void signOut()}>Sign out</button></div>
  </aside>;
}
