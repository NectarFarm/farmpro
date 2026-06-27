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
    // Generous timeouts: the in-build unit gate and integration logins do real
    // PBKDF2 hashing, which can briefly exceed a tight timeout when the CPU is
    // saturated during `docker compose build`. Headroom keeps the gate reliable.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
