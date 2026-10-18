import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'acceptance',
          environment: 'node',
          include: ['tests/acceptance/**/*.test.ts'],
          // Cada teste sobe um PGlite e aplica as migrações.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
