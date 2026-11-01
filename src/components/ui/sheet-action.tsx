'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const CloseSheet = createContext<(() => void) | null>(null);

/**
 * Para formulários dentro de um SheetAction: quando a Server Action dá certo, fecha o painel e mostra o aviso.
 * Fora de um painel, só mostra o aviso.
 */
export function useActionDone(state: { ok: boolean } | null, message?: string) {
  const close = useContext(CloseSheet);
  useEffect(() => {
    if (!state?.ok) return;
    close?.();
    if (message) toast(message);
  }, [state, close, message]);
}

/**
 * Ação secundária de uma tela (Antecipar, Estorno, Editar, Datas da fatura…): um botão que abre o formulário num
 * painel inferior, no lugar dos blocos `<details>` com triângulo. O painel fecha sozinho quando a ação dá certo.
 */
export function SheetAction({
  label,
  title,
  description,
  variant = 'outline',
  icon,
  className,
  children,
}: {
  label: string;
  title?: string;
  description?: React.ReactNode;
  variant?: 'outline' | 'default' | 'secondary' | 'ghost';
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} className={cn('w-full sm:w-auto', className)}>
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? label}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title ?? label}
          </DialogDescription>
        </DialogHeader>
        <CloseSheet.Provider value={close}>{children}</CloseSheet.Provider>
      </DialogContent>
    </Dialog>
  );
}
