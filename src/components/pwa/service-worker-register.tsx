'use client';

import { useEffect } from 'react';

/** Registra o service worker (só instalabilidade + cache de assets; o app não funciona offline). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((err: unknown) => {
        console.warn('Falha ao registrar o service worker', err);
      });
  }, []);
  return null;
}
