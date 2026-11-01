import type { Metadata } from 'next';
import { CardForm } from '@/components/cards/card-form';
import { CardContent } from '@/components/ui/card';
import { FormCard } from '@/components/forms/form-card';

export const metadata: Metadata = { title: 'Novo cartão' };

/** `?tipo=crediario`: crediário de loja (D73). */
export default async function NewCardPage({ searchParams }: PageProps<'/cartoes/novo'>) {
  const store = (await searchParams).tipo === 'crediario';
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{store ? 'Novo crediário' : 'Novo cartão'}</h1>
      {store && (
        <p className="text-sm text-muted-foreground">
          Crédito de loja com limite e fatura própria (Shopee Parcelado, carnê Magalu…). A 1ª compra abre uma
          fatura que vence depois do prazo; as compras até o fechamento entram nela, e cada parcela vai para a
          fatura do mês seguinte.
        </p>
      )}
      <FormCard>
        <CardContent>
          <CardForm kind={store ? 'STORE_CREDIT' : 'CARD'} />
        </CardContent>
      </FormCard>
      {!store && (
        <p className="text-center text-xs text-muted-foreground">
          Cartões virtuais não são cadastrados: lance as compras no cartão físico (mesmo limite, mesma
          fatura).
        </p>
      )}
    </div>
  );
}
