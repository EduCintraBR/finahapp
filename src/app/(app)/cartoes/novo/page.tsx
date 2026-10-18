import type { Metadata } from 'next';
import { CardForm } from '@/components/cards/card-form';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Novo cartão' };

export default function NewCardPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Novo cartão</h1>
      <Card>
        <CardContent>
          <CardForm />
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Cartões virtuais não são cadastrados: lance as compras no cartão físico (mesmo limite, mesma fatura).
      </p>
    </div>
  );
}
