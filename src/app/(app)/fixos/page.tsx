import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
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
    {
      title: 'Contas a pagar',
      direction: 'EXPENSE',
      items: templates.filter((t) => t.direction === 'EXPENSE'),
    },
    {
      title: 'Receitas previstas',
      direction: 'INCOME',
      items: templates.filter((t) => t.direction === 'INCOME'),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fixos e recorrentes"
        actions={
          <Button asChild size="sm">
            <Link href="/fixos/novo">
              <Plus aria-hidden /> Novo
            </Link>
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        Todo mês o app cria cada conta como pendente no dia do vencimento. Você dá baixa quando pagar.{' '}
        <Link href="/emprestimos" className="underline underline-offset-2">
          Empréstimos parcelados ficam em Empréstimos.
        </Link>
      </p>

      {sections.map((s) => {
        const sorted = [...s.items].sort(
          (a, b) => Number(statusOf(b, month).active) - Number(statusOf(a, month).active),
        );
        // total por mês do que vale agora (sem os encerrados nem os que ainda vão começar)
        const monthly = s.items
          .filter((t) => statusOf(t, month).active && statusOf(t, month).label === null)
          .reduce((sum, t) => sum + t.amountCents, 0);
        return (
          <section key={s.title} aria-label={s.title} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h2 className="text-sm font-medium text-muted-foreground">{s.title}</h2>
              {monthly > 0 && (
                <span className="text-sm" data-testid={`fixos-total-${s.direction}`}>
                  <Amount cents={monthly} className="font-semibold" />
                  <span className="text-muted-foreground"> /mês</span>
                </span>
              )}
            </div>
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
                        <div className="font-medium break-words">{t.description}</div>
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
