import { Field, MoneyInput } from '@/components/forms/fields';
import { Input } from '@/components/ui/input';
import { formatBRL, formatDecimalBR } from '@/domain/money';

/**
 * Aporte (D69): aparece quando o pagamento deixaria a conta sem saldo. O usuário diz quanto entrou e de onde veio;
 * isso vira uma entrada no saldo (fora das receitas) com a observação, para ele entender depois.
 * `shortCents` = o mínimo exigido (vem do servidor).
 */
export function FundingFields({ shortCents, idPrefix }: { shortCents: number; idPrefix: string }) {
  return (
    <div
      role="group"
      aria-label="Aporte"
      data-testid="funding-fields"
      className="space-y-3 rounded-lg border border-warning bg-warning/10 p-3"
    >
      <p className="text-sm font-medium">Saldo insuficiente: faltam {formatBRL(shortCents)} na conta.</p>
      <p className="text-xs text-muted-foreground">
        Registre de onde veio o dinheiro que cobre a diferença. Ele entra no saldo como um aporte (fora das
        receitas do mês), com a sua observação.
      </p>
      <Field label="Valor do aporte" htmlFor={`${idPrefix}-fundingAmount`}>
        <MoneyInput
          key={shortCents}
          id={`${idPrefix}-fundingAmount`}
          name="fundingAmount"
          required
          defaultValue={formatDecimalBR(shortCents)}
        />
      </Field>
      <Field
        label="De onde veio"
        htmlFor={`${idPrefix}-fundingNote`}
        hint="Ex.: poupança, empréstimo da mãe, venda do notebook."
      >
        <Input id={`${idPrefix}-fundingNote`} name="fundingNote" required minLength={3} maxLength={300} />
      </Field>
    </div>
  );
}
