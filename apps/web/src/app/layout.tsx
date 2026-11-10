import './globals.css';
export const metadata={title:'Career Intelligence',description:'Private job discovery and outreach intelligence'};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>;
}
