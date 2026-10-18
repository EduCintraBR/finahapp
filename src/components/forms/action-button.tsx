'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { ActionResult } from '@/lib/action-result';
import { FormError } from './fields';

type Action = (prev: ActionResult<null> | null, fd: FormData) => Promise<ActionResult<null>>;

/**
 * Botão que dispara uma Server Action com campos ocultos. Com `confirm`, pede confirmação
 * num diálogo antes (ações destrutivas: excluir, estornar, encerrar).
 */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'outline',
  confirm,
}: {
  action: Action;
  fields: Record<string, string | number>;
  label: string;
  pendingLabel?: string;
  variant?: 'outline' | 'destructive' | 'default' | 'secondary';
  confirm?: { title: string; description: string; confirmLabel: string };
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionResult<null> | null, fd: FormData) => {
      const r = await action(prev, fd);
      if (r.ok) setOpen(false);
      return r;
    },
    null,
  );

  const form = (submitLabel: string, submitVariant: typeof variant) => (
    <form action={formAction} className="contents">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={submitVariant} disabled={pending} className="w-full sm:w-auto">
        {pending ? (pendingLabel ?? 'Aguarde…') : submitLabel}
      </Button>
    </form>
  );

  const error = <FormError message={state && !state.ok ? state.error : null} />;

  if (!confirm) {
    return (
      <div className="space-y-2">
        {form(label, variant)}
        {error}
      </div>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} className="w-full sm:w-auto">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error}
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          {form(confirm.confirmLabel, variant === 'destructive' ? 'destructive' : 'default')}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
