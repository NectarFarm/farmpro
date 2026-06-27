import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { PWARegister } from '@/components/PWARegister';
import { getSettings } from '@/app/api/admin/settings/route';
import './globals.css';
import jsonMetadata from '../metadata.json';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Title/description follow the admin's branding. Falls back to defaults if the DB
// isn't reachable (e.g. during build) so this never breaks the app.
export async function generateMetadata(): Promise<Metadata> {
  let appName = 'IFMS', tagline = 'Integrated Farm Management System';
  try { const s = await getSettings(); appName = s.appName; tagline = s.tagline; } catch { /* defaults */ }
  return {
    ...jsonMetadata,
    title: appName,
    description: tagline,
    manifest: '/manifest.json',
    appleWebApp: { capable: true, title: appName, statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = {
  themeColor: '#166534',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
