'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Abre a impressão do navegador (no celular, também "Salvar como PDF"). */
export function PrintButton({ label = 'Imprimir' }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="w-full sm:w-auto">
      <Printer aria-hidden /> {label}
    </Button>
  );
}
