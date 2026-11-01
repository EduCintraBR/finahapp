import { addMonths, formatMonthLabel, parseMonthParam, toMonthParam } from '@/domain/dates';
import { NativeSelect } from './fields';

/**
 * Mês ("AAAA-MM", o mesmo valor do antigo `type=month`) num select nativo com o nome por extenso em pt-BR
 * ("Outubro de 2026"). O `type=month` cortava o texto no celular ("outubro de 2") e nem existe em todo navegador.
 * As opções vão de `before` meses antes de `around` até `after` meses depois; sem `required`, a 1ª é "—" (vazio).
 */
export function MonthField({
  id,
  name,
  around,
  defaultValue,
  required,
  before = 24,
  after = 60,
}: {
  id: string;
  name: string;
  /** mês de referência da lista ("AAAA-MM"), normalmente o mês atual */
  around: string;
  defaultValue?: string;
  required?: boolean;
  before?: number;
  after?: number;
}) {
  const center = parseMonthParam(around) ?? parseMonthParam(defaultValue)!;
  const months = Array.from({ length: before + after + 1 }, (_, i) => addMonths(center, i - before));
  // o valor atual sempre entra na lista, mesmo fora da faixa
  const current = parseMonthParam(defaultValue);
  if (current && !months.includes(current)) months.push(current);
  months.sort();
  return (
    <NativeSelect id={id} name={name} required={required} defaultValue={defaultValue ?? ''}>
      {!required && <option value="">—</option>}
      {months.map((m) => {
        const label = formatMonthLabel(m);
        return (
          <option key={m} value={toMonthParam(m)}>
            {label.charAt(0).toUpperCase() + label.slice(1)}
          </option>
        );
      })}
    </NativeSelect>
  );
}
