import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { BenefitEditForm, EndBenefitForm } from '@/components/benefits/benefit-forms';
import { ActionButton } from '@/components/forms/action-button';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { getBenefitCard, listBenefitMovements } from '@/db/queries/benefits';
import { creditDateFor } from '@/domain/benefits/credits';
import {
  addMonths,
  compareDates,
  formatDateBR,
  formatMonthLabel,
  formatMonthShort,
  monthStart,
  today,
  toMonthParam,
} from '@/domain/dates';
import { formatDecimalBR } from '@/domain/money';
import { resolveMonth } from '@/lib/month';
import { cn } from '@/lib/utils';
import { ensureOccurrences } from '@/server/ensure-occurrences';
import { deleteBenefitSpendAction } from '../actions';

export const metadata: Metadata = { title: 'Cartão de benefícios' };

const RULE_LABEL = { LAST_BUSINESS_DAY: 'no último dia útil do mês', DAY_OF_MONTH: 'em dia fixo' } as const;

export default async function BenefitCardPage({ params, searchParams }: PageProps<'/beneficios/[id]'>) {
  await ensureOccurrences(); // creditar o que já caiu
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const hoje = today();
  const month = await resolveMonth(searchParams);
  const [card, movements] = await Promise.all([
    getBenefitCard(db, id, hoje, month),
    listBenefitMovements(db, id),
  ]);
  if (!card) notFound();

  const current = monthStart(hoje);
  // sugestão para encerrar: o mês atual se o crédito dele já caiu, senão o mês anterior
  const creditThisMonth = compareDates(
    creditDateFor({ rule: card.creditRule, day: card.creditDay }, current),
    hoje,
  );
  const lastMonthSuggestion =
    creditThisMonth <= 0 ? toMonthParam(current) : toMonthParam(addMonths(current, -1));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/cartoes">
          <ArrowLeft aria-hidden /> Cartões
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={card.ended || card.endMonth ? 'outline' : 'secondary'}>
              {card.ended
                ? 'Encerrado'
                : card.endMonth
                  ? `Encerra em ${formatMonthShort(card.endMonth)}`
                  : 'Ativo'}
            </Badge>
            {card.last4 && <Badge variant="outline">final {card.last4}</Badge>}
          </div>
          <CardTitle className="text-xl">{card.name}</CardTitle>
          <Amount cents={card.totalBalanceCents} className="text-3xl font-semibold" />
          <CardDescription>
            {card.issuer ? `${card.issuer} · ` : ''}crédito{' '}
            {card.creditRule === 'DAY_OF_MONTH' ? `todo dia ${card.creditDay}` : RULE_LABEL[card.creditRule]}
            {card.nextCreditDate
              ? ` · próximo em ${formatDateBR(card.nextCreditDate)}`
              : card.ended
                ? ` · encerrado (último crédito em ${formatMonthLabel(card.endMonth!)})`
                : ''}
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {card.wallets.map((w) => (
          <Card key={w.id}>
            <CardHeader className="pb-2">
              <CardDescription>{w.name}</CardDescription>
              <Amount
                cents={w.balanceCents}
                className="text-2xl font-semibold"
                data-testid={`saldo-${w.name}`}
              />
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Crédito mensal</span>
                <Amount cents={w.monthlyCreditCents} />
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span className="first-letter:uppercase">Creditado em {formatMonthLabel(month)}</span>
                <Amount
                  cents={w.creditedInMonthCents}
                  direction={w.creditedInMonthCents ? 'in' : undefined}
                />
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span className="first-letter:uppercase">Gasto em {formatMonthLabel(month)}</span>
                <Amount cents={w.spentInMonthCents} direction={w.spentInMonthCents ? 'out' : undefined} />
              </div>
              <Button asChild size="sm" variant="outline" className="mt-2 w-full">
                <Link href={`/lancamentos/novo?tipo=beneficio&carteira=${w.id}`}>
                  <Plus aria-hidden /> Novo gasto
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Histórico</CardTitle>
          <CardDescription>
            Créditos, saldo inicial e gastos, do mais recente para o mais antigo.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {movements.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada lançado ainda.</p>
          ) : (
            movements.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium break-words">{m.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateBR(m.date)} · {m.walletName}
                    {m.type === 'SPEND' && m.categoryName ? ` · ${m.categoryName}` : ''}
                    {m.type === 'SPEND' ? ` · por ${m.createdByName}` : ''}
                  </div>
                </div>
                <Amount
                  cents={m.amountCents}
                  direction={m.kind === 'INCOME' ? 'in' : 'out'}
                  className={cn('font-medium')}
                />
                {m.type === 'SPEND' && (
                  <div className="shrink-0">
                    <ActionButton
                      action={deleteBenefitSpendAction}
                      fields={{ id: m.id }}
                      label="Excluir"
                      variant="destructive"
                      icon={<Trash2 aria-hidden />}
                      confirm={{
                        title: 'Excluir este gasto?',
                        description: `${m.description} volta para o saldo de ${m.walletName} e sai dos relatórios. Fica registrado no histórico de alterações.`,
                        confirmLabel: 'Excluir',
                      }}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ações em botões que abrem painel (antes: bloco <details> e card de encerrar com o vermelho à vista) */}
      <div className={cn('grid gap-2', !card.endMonth && 'grid-cols-2')}>
        <SheetAction label="Editar" title="Editar cartão de benefícios" icon={<Pencil aria-hidden />}>
          <BenefitEditForm
            id={card.id}
            defaults={{
              name: card.name,
              issuer: card.issuer,
              last4: card.last4,
              rule: card.creditRule,
              day: card.creditDay,
            }}
            wallets={card.wallets.map((w) => ({
              id: w.id,
              name: w.name,
              creditText: formatDecimalBR(w.monthlyCreditCents),
            }))}
          />
        </SheetAction>
        {!card.endMonth && (
          <SheetAction
            label="Encerrar"
            title="Encerrar cartão"
            description="Quando o benefício acabar: para o crédito automático. O histórico e o saldo que sobrar ficam."
          >
            <EndBenefitForm id={card.id} defaultMonth={lastMonthSuggestion} />
          </SheetAction>
        )}
      </div>
    </div>
  );
}
