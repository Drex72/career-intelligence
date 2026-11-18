'use client';
import Link from 'next/link';
import {PageHeading} from '@/components/WorkspaceUI';
import {DiscoveryPreferences} from '@/components/DiscoveryPreferences';

export default function SearchSettings(){
  return <div className="settings-page">
    <PageHeading meta="WORKSPACE / SEARCH SETTINGS" title="Search settings"
      description="Tell the system where you can work and which roles you want. Search runs and your daily list both use these settings."
      action={<Link className="button-secondary" href="/">Back to today’s list</Link>}/>
    <DiscoveryPreferences/>
  </div>;
}
