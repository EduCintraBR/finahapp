'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { formatBRL } from '@/domain/money';

export type EvolutionPoint = { month: string; label: string; monthlyCents: number; grossCents: number };

const SERIES = [
  { key: 'monthlyCents', name: 'Mensal', color: 'var(--series-1)' },
  { key: 'grossCents', name: 'Bruto', color: 'var(--series-2)' },
] as const;

/** Eixo em reais compactos ("R$ 1,2 mil"); os valores exatos ficam no tooltip e na tabela. */
const compact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const axisLabel = (cents: number) => compact.format(Math.trunc(cents / 100));

function ChartTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium first-letter:uppercase">{label}</div>
      {SERIES.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="text-muted-foreground">{s.name}</span>
            <span className="ml-auto font-medium tabular-nums">{formatBRL(Number(p?.value ?? 0))}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Evolução dos últimos 12 meses: Gasto Mensal (caixa) × Gasto Bruto (competência), mesmo eixo. */
export function EvolutionChart({ data }: { data: EvolutionPoint[] }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-xs text-muted-foreground" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div
        className="h-56 w-full"
        role="img"
        aria-label="Gráfico de Gasto Mensal e Bruto nos últimos 12 meses"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              tickFormatter={axisLabel}
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip
              content={ChartTooltip}
              cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 4, fill: s.color, stroke: 'var(--card)', strokeWidth: 2 }}
                activeDot={{ r: 6, fill: s.color, stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Ver em tabela</summary>
        <table className="mt-2 w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Mês</th>
              <th className="py-1 text-right font-normal">Mensal</th>
              <th className="py-1 text-right font-normal">Bruto</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-t">
                <td className="py-1 first-letter:uppercase">{d.label}</td>
                <td className="py-1 text-right">{formatBRL(d.monthlyCents)}</td>
                <td className="py-1 text-right">{formatBRL(d.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
