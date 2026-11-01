'use client';

import { useEffect, useState } from 'react';

type Toast = { id: number; message: string };

const listeners = new Set<(t: Toast) => void>();
let nextId = 1;

/** Aviso curto no rodapé ("Antecipação registrada."), para quando o painel da ação já fechou. */
export function toast(message: string) {
  const t = { id: nextId++, message };
  for (const l of listeners) l(t);
}

/** Onde os avisos aparecem: logo acima da barra inferior no celular; no canto de baixo no desktop. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((s) => [...s, t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 4_000);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto max-w-sm animate-in rounded-lg bg-foreground px-4 py-2.5 text-sm text-background shadow-lg fade-in-0 slide-in-from-bottom-2"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
