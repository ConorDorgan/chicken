import { Baloo_2, Nunito } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmProvider } from '@/components/game-ui';
import './globals.css';

const baloo = Baloo_2({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-baloo' });
const nunito = Nunito({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-nunito' });

export const metadata = {
  title: 'Find the Chicken',
  description: 'A pub hunt: find the chicken, one pint at a time.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Chicken', statusBarStyle: 'black-translucent' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0e1433' },
    { media: '(prefers-color-scheme: light)', color: '#e8edff' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${baloo.variable} ${nunito.variable}`}>
      <body>
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
