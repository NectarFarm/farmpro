import type { Metadata, Viewport } from 'next';
import { Fraunces, Outfit } from 'next/font/google';
import './global.css';

// Two real typefaces, self-hosted at build time (next/font/google downloads
// and serves them from this app — no runtime fetch to Google, which matters
// for an app that ships as an offline-capable Android APK).
//
// ui/governance-reference-redesign: replaces the previous single-typeface
// system (Schibsted Grotesk for everything) with the reference design's
// pairing — Outfit is the body/UI grotesque, Fraunces is the serif used for
// display headings (page titles, dossier/detail headings). Both are wired
// into app/global.css as --font-sans / --font-display so every screen picks
// the pairing up through the token layer, not by importing a font directly.
const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  // Fraunces is a variable-optical-size family; 'soft' softens the default
  // display-cut terminals slightly so large headings don't read as a wedding
  // invitation next to Outfit's plain body text.
  axes: ['opsz', 'SOFT'],
});

export const metadata: Metadata = {
  title: 'IFMS',
  description: 'Integrated Farm Management System',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Reference palette's primary green (app/global.css's --primary-green) —
  // colours the browser/PWA chrome (Android task switcher, status bar) to
  // match the app instead of the OS default white/black.
  themeColor: '#2a5340',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${outfit.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
