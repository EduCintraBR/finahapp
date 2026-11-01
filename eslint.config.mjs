import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Invariante 1: dinheiro nunca passa por float.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Dinheiro é inteiro em centavos: use parseBRL de @/domain/money.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: 'Use parseBRL de @/domain/money.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // As queries de referência do teste de aceitação usam linhas não tipadas do PGlite.
    files: ['tests/acceptance/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  globalIgnores(['.next/**', '.next-*/**', 'out/**', 'build/**', 'dist/**', 'next-env.d.ts', 'drizzle/**']),
]);
