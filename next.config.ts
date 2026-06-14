import type { NextConfig } from 'next';
import dotenv from 'dotenv';

// Load .env into process.env (dotenv.populate is used internally to inject)
dotenv.config({ path: '.env', override: true });

// When CAPACITOR_BUILD=1 we produce a fully-static export that Capacitor
// copies into the Android WebView. Otherwise the app runs as normal Next.js.
const isCapacitor = process.env.CAPACITOR_BUILD === '1';

const nextConfig: NextConfig = {
  reactStrictMode: false,
  turbopack: {},
  typescript: {
    ignoreBuildErrors: true,
  },

  serverExternalPackages: [],
  allowedDevOrigins: ['**.*.*'],

  // Static export settings for Capacitor APK
  ...(isCapacitor && {
    output: 'export',
    distDir: 'out',
    images: { unoptimized: true },
    trailingSlash: true,
    basePath: '',
  }),
};

export default nextConfig;

