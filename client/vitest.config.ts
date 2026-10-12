import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  // Sell-refund parity tests import the server module (sibling directory).
  server: {
    fs: { allow: ['..'] },
  },
});
