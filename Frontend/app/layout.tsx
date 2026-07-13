import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
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
    icons: { apple: '/apple-touch-icon.png' },
  };
}

export const viewport: Viewport = {
  themeColor: '#166534',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Pinned to light for now: most page markup still hardcodes bg-white/
            text-gray-900 etc. rather than the token classes that respond to
            `.dark` (that migration is Phase 2/3 of the UI revamp, not done
            yet). Defaulting to the OS's dark preference today would mix a
            correctly-dark shadcn primitive (e.g. the nav drawer) against
            still-light page content — a broken half-dark screen for any
            Android user whose system theme is dark, which is common. The
            toggle infra stays wired for once that coverage lands. */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
        <PWARegister />
      </body>
    </html>
  );
}
