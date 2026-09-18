import type { Metadata, Viewport } from 'next';
import { Schibsted_Grotesk } from 'next/font/google';
import './global.css';

// One real typeface, self-hosted at build time (next/font/google downloads
// and serves it from this app — no runtime fetch to Google, which matters
// for an app that ships as an offline-capable Android APK). Schibsted
// Grotesk: a humanist grotesque with open apertures that stays legible at
// small sizes in bright sunlight, and has actual character in its a/g/k —
// see app/global.css's --font-sans for how this is wired into the token
// layer (kept as --font-schibsted, not --font-sans directly, so global.css
// fully controls the fallback chain).
const schibstedGrotesk = Schibsted_Grotesk({
  subsets: ['latin'],
  variable: '--font-schibsted',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'IFMS',
  description: 'Integrated Farm Management System',
};

export const viewport: Viewport = {
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
    <html lang="en" suppressHydrationWarning className={schibstedGrotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
