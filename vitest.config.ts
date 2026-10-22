import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@moneybee/shared': path.resolve(__dirname, 'packages/shared/src/index.ts') } },
  test: {
    include: ['apps/api/test/**/*.test.ts', 'packages/shared/test/**/*.test.ts'],
    testTimeout: 30000,
    environment: 'node',
  },
});
