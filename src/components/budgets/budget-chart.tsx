'use client';

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { BudgetLevel } from '@/domain/budgets/budgets';
import { formatBRL } from '@/domain/money';

export type BudgetChartPoint = {
  month: string;
  label: string;
  spentCents: number;
  limitCents: number | null;
  level: BudgetLevel | null;
  selected: boolean;
};

/** Cor da barra pela situação do mês; mês sem orçamento fica neutro. */
const FILL: Record<BudgetLevel | 'none', string> = {
  ok: 'var(--income)',
  warning: 'var(--warning)',
  over: 'var(--expense)',
  none: 'var(--series-other)',
};
const LEVEL_TEXT: Record<BudgetLevel, string> = {
  ok: 'no controle',
  warning: 'perto do limite',
  over: 'passou',
};

const compact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const axisLabel = (cents: number) => compact.format(Math.trunc(cents / 100));

function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const p = active ? (payload?.[0]?.payload as BudgetChartPoint | undefined) : undefined;
  if (!p) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium first-letter:uppercase">{p.label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Gasto</span>
        <span className="font-medium tabular-nums">{formatBRL(p.spentCents)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Orçamento</span>
        <span className="tabular-nums">{p.limitCents === null ? '—' : formatBRL(p.limitCents)}</span>
      </div>
      {p.level && <div className="mt-1 text-muted-foreground">{LEVEL_TEXT[p.level]}</div>}
    </div>
  );
}

/**
 * Gasto (barras, coloridas pela situação) × orçamento de cada mês (linha tracejada), nos últimos meses.
 * O mês escolhido fica destacado; os valores exatos ficam no tooltip e na tabela.
 */
export function BudgetChart({ data, title }: { data: BudgetChartPoint[]; title: string }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: FILL.ok }} /> Gasto
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-foreground/70" /> Orçamento
        </span>
      </div>
      <div className="h-48 w-full md:h-60" role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              interval={0}
            />
            <YAxis
              tickFormatter={axisLabel}
              tickLine={false}
              axisLine={false}
              width={60}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip content={ChartTooltip} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
            <Bar dataKey="spentCents" name="Gasto" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.month}
                  fill={FILL[d.level ?? 'none']}
                  fillOpacity={d.selected ? 1 : 0.55}
                  stroke={d.selected ? 'var(--foreground)' : undefined}
                  strokeWidth={d.selected ? 1 : 0}
                />
              ))}
            </Bar>
            <Line
              dataKey="limitCents"
              name="Orçamento"
              type="linear"
              stroke="var(--foreground)"
              strokeOpacity={0.7}
              strokeWidth={2}
              strokeDasharray="5 4"
              connectNulls={false}
              dot={{ r: 3, fill: 'var(--foreground)', strokeWidth: 0 }}
              activeDot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Ver em tabela</summary>
        <table className="mt-2 w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Mês</th>
              <th className="py-1 text-right font-normal">Gasto</th>
              <th className="py-1 text-right font-normal">Orçamento</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-t">
                <td className="py-1 first-letter:uppercase">{d.label}</td>
                <td className="py-1 text-right">{formatBRL(d.spentCents)}</td>
                <td className="py-1 text-right">{d.limitCents === null ? '—' : formatBRL(d.limitCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
