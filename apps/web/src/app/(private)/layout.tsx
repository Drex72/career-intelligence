import type { ReactNode } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { Navigation } from '@/components/Navigation';
export default function PrivateLayout({children}:{children:ReactNode}){
  return <AuthGate><div className="workspace"><a href="#main-content" className="skip-link">Skip to content</a><Navigation/><main id="main-content" tabIndex={-1} className="content">{children}</main></div></AuthGate>;
}
