import './globals.css';

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
  themeColor: '#1b1712',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
