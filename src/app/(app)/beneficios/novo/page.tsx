import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BenefitCardForm } from '@/components/benefits/benefit-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { creditDateFor } from '@/domain/benefits/credits';
import { addMonths, compareDates, monthStart, today, toMonthParam } from '@/domain/dates';

export const metadata: Metadata = { title: 'Novo cartão de benefícios' };
export const dynamic = 'force-dynamic';

export default function NewBenefitCardPage() {
  const hoje = today();
  // primeiro mês cujo crédito (no último dia útil) ainda não caiu
  let first = monthStart(hoje);
  while (compareDates(creditDateFor({ rule: 'LAST_BUSINESS_DAY', day: null }, first), hoje) <= 0) {
    first = addMonths(first, 1);
  }
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/cartoes">
          <ArrowLeft aria-hidden /> Cartões
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Novo cartão de benefícios</CardTitle>
          <CardDescription>
            Cartão pré-pago da empresa (multibenefícios, refeição e alimentação). Todo mês o app credita o
            valor de cada carteira, como uma receita, sem mexer no saldo da conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BenefitCardForm defaultStartMonth={toMonthParam(first)} />
        </CardContent>
      </Card>
    </div>
  );
}
