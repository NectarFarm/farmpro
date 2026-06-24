import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside a server bundle; stub it for tests.
      'server-only': path.resolve(__dirname, 'tests/_stubs/empty.ts'),
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    // Unit + integration live under tests/; e2e (Playwright) is run separately.
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    testTimeout: 20000,
  },
});
