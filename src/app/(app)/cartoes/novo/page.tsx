import type { Metadata } from 'next';
import { CardForm } from '@/components/cards/card-form';
import { CardContent } from '@/components/ui/card';
import { FormCard } from '@/components/forms/form-card';

export const metadata: Metadata = { title: 'Novo cartão' };

export default function NewCardPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Novo cartão</h1>
      <FormCard>
        <CardContent>
          <CardForm />
        </CardContent>
      </FormCard>
      <p className="text-center text-xs text-muted-foreground">
        Cartões virtuais não são cadastrados: lance as compras no cartão físico (mesmo limite, mesma fatura).
      </p>
    </div>
  );
}
