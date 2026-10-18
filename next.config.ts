import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // O E2E usa outra pasta para rodar ao lado do `pnpm dev` do dia a dia.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // O botão flutuante do dev tools fica em cima da navegação inferior no celular.
  devIndicators: false,
  // Sem sharp no container: os ícones são PNG gerados em build, não há otimização de imagem.
  images: { unoptimized: true },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
