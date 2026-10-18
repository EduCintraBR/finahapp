import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import { listTemplates, type TemplateRow } from '@/db/queries/entries';
import { compareDates, formatMonthLabel, monthStart, today } from '@/domain/dates';
import { PAYMENT_METHOD_LABEL } from '@/lib/labels';

export const metadata: Metadata = { title: 'Fixos e recorrentes' };

function statusOf(t: TemplateRow, month: string) {
  if (!t.isActive) return { label: 'Desativado', active: false };
  if (t.endMonth && compareDates(t.endMonth, month) < 0)
    return { label: `Encerrado em ${formatMonthLabel(t.endMonth)}`, active: false };
  if (compareDates(t.startMonth, month) > 0)
    return { label: `Começa em ${formatMonthLabel(t.startMonth)}`, active: true };
  return { label: null, active: true };
}

export default async function TemplatesPage() {
  const templates = await listTemplates(getDb());
  const month = monthStart(today());
  const sections = [
    { title: 'Contas a pagar', items: templates.filter((t) => t.direction === 'EXPENSE') },
    { title: 'Receitas previstas', items: templates.filter((t) => t.direction === 'INCOME') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Fixos e recorrentes</h1>
        <Button asChild size="sm">
          <Link href="/fixos/novo">
            <Plus aria-hidden /> Novo
          </Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Todo mês o app cria cada conta como pendente no dia do vencimento. Você dá baixa quando pagar.
      </p>

      {sections.map((s) => {
        const sorted = [...s.items].sort(
          (a, b) => Number(statusOf(b, month).active) - Number(statusOf(a, month).active),
        );
        return (
          <section key={s.title} className="space-y-2">
            <h2 className="px-1 text-sm font-medium text-muted-foreground">{s.title}</h2>
            {sorted.length === 0 ? (
              <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum cadastrado.
              </p>
            ) : (
              <div className="divide-y overflow-hidden rounded-xl border bg-card">
                {sorted.map((t) => {
                  const st = statusOf(t, month);
                  return (
                    <Link
                      key={t.id}
                      href={`/fixos/${t.id}`}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/50 ${st.active ? '' : 'opacity-60'}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.description}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>dia {t.dayOfMonth}</span>
                          <span aria-hidden>·</span>
                          <span>{t.categoryName}</span>
                          <span aria-hidden>·</span>
                          <span>{PAYMENT_METHOD_LABEL[t.paymentMethod]}</span>
                          {t.type === 'RECURRING_VARIABLE' && <Badge variant="outline">estimado</Badge>}
                          {st.label && <Badge variant="secondary">{st.label}</Badge>}
                        </div>
                      </div>
                      <Amount
                        cents={t.amountCents}
                        direction={t.direction === 'INCOME' ? 'in' : 'out'}
                        className="text-sm font-medium"
                      />
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
