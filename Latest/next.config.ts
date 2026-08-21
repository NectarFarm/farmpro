import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Traces the exact server dependencies into .next/standalone so the Docker
  // runner stage can drop node_modules entirely — that removed a second
  // full `pnpm install --prod` and took the image from ~1.01GB to ~384MB.
  output: 'standalone',
  // LAN device(s) accessing the dev server's HMR websocket (Next.js blocks
  // cross-origin dev resources by default). Add more IPs here as needed.
  allowedDevOrigins: ['192.168.100.14', '192.168.8.166'],
  turbopack: {
    // Without this, Turbopack walks up and finds the parent IFMS repo's own
    // pnpm-workspace.yaml and treats that whole tree as the workspace root —
    // scanning/watching sibling directories (Frontend/, apk-build/, worktrees)
    // that have nothing to do with this app. Pin it to this directory.
    root: __dirname,
  },
};

export default nextConfig;
