/**
 * Empacota os entrypoints que rodam fora do Next (worker, migrate, seed) em dist/*.mjs,
 * com todas as dependências embutidas. Assim a imagem de produção só precisa do
 * output standalone do Next + estes arquivos.
 */
import { build } from 'esbuild';

await build({
  entryPoints: {
    worker: 'src/worker/index.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // Dependências CJS empacotadas em ESM ainda chamam require() de módulos do Node.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  external: ['pg-native'],
  logLevel: 'info',
});
