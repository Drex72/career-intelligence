import type { ReactNode } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { Navigation } from '@/components/Navigation';
export default function PrivateLayout({children}:{children:ReactNode}){
  return <AuthGate><div className="workspace"><Navigation/><main className="content">{children}</main></div></AuthGate>;
}
