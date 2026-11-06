import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';
import { RotationList } from '@/components/stock/rotation-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { rotationLots, type RotationLot } from '@/db/queries/stock';
import { today } from '@/domain/dates';

export const metadata: Metadata = { title: 'Rodízio' };

function Section({
  title,
  description,
  lots,
  hoje,
}: {
  title: string;
  description: string;
  lots: RotationLot[];
  hoje: string;
}) {
  if (lots.length === 0) return null;
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-3">
        <CardTitle>
          {title} <span className="text-muted-foreground">({lots.length})</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="border-t px-0">
        <RotationList lots={lots} today={hoje} />
      </CardContent>
    </Card>
  );
}

/**
 * Rodízio (D85): os lotes com estoque da casa toda, na ordem de uso. Primeiro o que pede atenção (vencido,
 * vencendo em 30 dias, conferência que chegou), depois o resto, com a idade de cada lote.
 */
export default async function RotationPage() {
  const hoje = today();
  const lots = await rotationLots(getDb(), hoje);
  const attention = lots.filter((l) => l.expiry === 'expired' || l.expiry === 'soon' || l.checkDue);
  const rest = lots.filter((l) => !attention.includes(l));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Rodízio"
        description="O que vence primeiro vem antes. Use, troque ou confira o que está marcado."
      />
      {lots.length === 0 ? (
        <Card>
          <CardContent className="py-2 text-center text-sm text-muted-foreground">
            Nenhum lote com estoque ainda.
          </CardContent>
        </Card>
      ) : (
        <>
          <Section
            title="Pede atenção"
            description="Vencido, vencendo nos próximos 30 dias ou com a conferência na data."
            lots={attention}
            hoje={hoje}
          />
          <Section title="Em dia" description="Na ordem de uso." lots={rest} hoje={hoje} />
        </>
      )}
    </div>
  );
}
