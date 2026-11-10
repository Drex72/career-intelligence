import '@radix-ui/themes/styles.css';
import './globals.css';
import {Theme} from '@radix-ui/themes';
export const metadata={title:'Career Intelligence',description:'Evidence-backed career research, opportunities and outreach',icons:{icon:'/brand-mark.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body><Theme appearance="light" accentColor="violet" grayColor="slate" radius="large" scaling="100%">{children}</Theme></body></html>;
}
