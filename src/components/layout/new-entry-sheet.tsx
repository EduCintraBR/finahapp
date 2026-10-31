'use client';

import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, CreditCard, Utensils, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Option = { href: string; label: string; hint: string; icon: LucideIcon; tone: string };

const OPTIONS: Option[] = [
  {
    href: '/lancamentos/novo',
    label: 'Despesa',
    hint: 'Saiu ou vai sair da conta',
    icon: ArrowUpRight,
    tone: 'bg-expense/15 text-expense',
  },
  {
    href: '/lancamentos/novo?tipo=receita',
    label: 'Receita',
    hint: 'Entrou na conta',
    icon: ArrowDownLeft,
    tone: 'bg-income/15 text-income',
  },
  {
    href: '/lancamentos/novo?tipo=cartao',
    label: 'Compra no cartão',
    hint: 'À vista ou parcelada',
    icon: CreditCard,
    tone: 'bg-primary/15 text-primary',
  },
  {
    href: '/lancamentos/novo?tipo=beneficio',
    label: 'Gasto no benefício',
    hint: 'Vale-alimentação ou refeição',
    icon: Utensils,
    tone: 'bg-primary/15 text-primary',
  },
];

/** Botão (+): escolhe o tipo antes de abrir o formulário (2 toques a partir de qualquer tela). */
export function NewEntrySheet({ children }: { children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo lançamento</DialogTitle>
          <DialogDescription>O que você quer lançar?</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {OPTIONS.map(({ href, label, hint, icon: Icon, tone }) => (
            <DialogClose key={href} asChild>
              <Link
                href={href}
                className="flex min-h-28 flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:bg-accent active:scale-[0.98]"
              >
                <span className={cn('flex size-9 items-center justify-center rounded-full', tone)}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="text-sm leading-tight font-semibold">{label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
              </Link>
            </DialogClose>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Conta que se repete todo mês ou assinatura?{' '}
          <DialogClose asChild>
            <Link href="/fixos/novo" className="font-medium text-primary underline-offset-4 hover:underline">
              Cadastre em Fixos
            </Link>
          </DialogClose>
        </p>
      </DialogContent>
    </Dialog>
  );
}
