import './globals.css';
export const metadata={title:'Career Intelligence',description:'Evidence-backed career research, opportunities and outreach',icons:{icon:'/brand-mark.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>;
}
