import type { Metadata } from 'next';
import { EntryForm } from '@/components/entries/entry-form';
import { Card, CardContent } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listBenefitCards } from '@/db/queries/benefits';
import { listActiveCards } from '@/db/queries/cards';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { monthStart, today } from '@/domain/dates';
import { formatBRL } from '@/domain/money';

export const metadata: Metadata = { title: 'Novo lançamento' };

export default async function NewEntryPage({ searchParams }: PageProps<'/lancamentos/novo'>) {
  const { tipo, cartao, carteira } = await searchParams;
  const db = getDb();
  const hoje = today();
  const [categories, users, cards, benefitCards] = await Promise.all([
    listCategories(db),
    listUsers(db),
    listActiveCards(db),
    listBenefitCards(db, hoje, monthStart(hoje)),
  ]);
  // carteiras de cartões de benefícios (inclusive encerrados: o saldo que sobrou ainda pode ser gasto)
  const wallets = benefitCards.flatMap((c) =>
    c.wallets.map((w) => ({ id: w.id, label: `${c.name} · ${w.name} · saldo ${formatBRL(w.balanceCents)}` })),
  );
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Novo lançamento</h1>
      <Card>
        <CardContent>
          <EntryForm
            categories={categories}
            users={users}
            today={hoje}
            returnTo="/lancamentos"
            cards={cards.map((c) => ({ id: c.id, name: c.name }))}
            wallets={wallets}
            initialMode={tipo === 'cartao' ? 'CARD' : tipo === 'beneficio' ? 'BENEFIT' : undefined}
            initialWalletId={wallets.find((w) => w.id === carteira)?.id}
            // vindo da tela de um cartão, a compra já vem nesse cartão (e não no primeiro da lista)
            initialCardId={cards.find((c) => c.id === cartao)?.id}
          />
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Contas que se repetem todo mês (inclusive assinaturas no cartão): cadastre em Fixos.
      </p>
    </div>
  );
}
