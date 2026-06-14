import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Use esbuild's automatic JSX runtime (React 17+) instead of @vitejs/plugin-react,
  // which pulls in a conflicting Vite version under Vitest 3.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'android', 'dist', '.open-next'],
  },
});
