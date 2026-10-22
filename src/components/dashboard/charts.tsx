'use client';

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { formatBRL } from '@/domain/money';

export type Slice = { key: string; name: string; cents: number; color: string };
export type MonthBar = { month: string; label: string; cents: number; selected: boolean };

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);

/**
 * Para onde foi o dinheiro: pizza (rosca) das maiores categorias + "Outras". As cores são a paleta validada
 * (CVD e contraste nos dois temas); no tema claro três delas têm contraste baixo com o fundo, por isso há sempre
 * a legenda com nome, valor e percentual (identidade nunca só pela cor) e um vão entre as fatias.
 */
export function CategoryDonut({ slices, totalCents }: { slices: Slice[]; totalCents: number }) {
  if (slices.length === 0 || totalCents <= 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sem gastos neste mês ainda.</p>;
  }
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div
        className="relative h-44 w-44 shrink-0"
        role="img"
        aria-label={`Gastos por categoria: ${slices.map((s) => `${s.name} ${pct(s.cents, totalCents)}%`).join(', ')}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="cents"
              nameKey="name"
              innerRadius={56}
              outerRadius={84}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={(props) => <DonutTooltip {...props} total={totalCents} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] text-muted-foreground">Compras do mês</span>
          <span className="text-sm font-semibold tabular-nums">{formatBRL(totalCents)}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2" aria-label="Legenda das categorias">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{pct(s.cents, totalCents)}%</span>
            <span className="w-24 text-right font-medium tabular-nums">{formatBRL(s.cents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DonutTooltip({
  active,
  payload,
  total,
}: TooltipContentProps<ValueType, NameType> & { total: number }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!;
  const cents = Number(p.value ?? 0);
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{String(p.name)}</div>
      <div className="tabular-nums">
        {formatBRL(cents)} · {pct(cents, total)}%
      </div>
    </div>
  );
}

/** O que saiu da conta nos últimos meses (Mensal): uma série só; o mês escolhido em destaque. */
export function MonthlyBars({ bars }: { bars: MonthBar[] }) {
  const max = Math.max(...bars.map((b) => b.cents), 0);
  if (max <= 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sem saídas nestes meses.</p>;
  }
  return (
    <div
      className="h-44 w-full"
      role="img"
      aria-label={`Saídas por mês: ${bars.map((b) => `${b.label} ${formatBRL(b.cents)}`).join(', ')}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            content={(props) => <BarTooltip {...props} />}
          />
          <Bar dataKey="cents" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {bars.map((b) => (
              <Cell key={b.month} fill="var(--series-1)" fillOpacity={b.selected ? 1 : 0.4} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const b = payload?.[0]?.payload as MonthBar | undefined;
  if (!active || !b) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium first-letter:uppercase">{b.label}</div>
      <div className="tabular-nums">{formatBRL(b.cents)}</div>
    </div>
  );
}
