'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { MoneyInput, NativeSelect } from '@/components/forms/fields';
import { Amount } from '@/components/money/amount';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  addMonths,
  compareDates,
  formatDateBR,
  formatDayLabel,
  formatMonthLabel,
  monthEnd,
  monthStart,
  type ISODate,
} from '@/domain/dates';
import { formatBRL, tryParseBRL, type Cents } from '@/domain/money';
import {
  firstNegativeFrom,
  firstNegativePoint,
  lowestFrom,
  lowestPoint,
  pointsRoom,
  purchaseCharges,
  shiftBalances,
  simulate,
  type BalancePoint,
  type CashFlow,
  type ForecastDay,
  type SimulatedCharge,
} from '@/domain/reports/cash-forecast';
import { cn } from '@/lib/utils';

export type ForecastCardOption = {
  id: string;
  name: string;
  isAdditional: boolean;
  availableCents: Cents | null;
  dueDates: ISODate[];
};

const shortDate = (d: ISODate) => formatDateBR(d).slice(0, 5);

// ─────────── gráfico ───────────

type ChartRow = { date: ISODate; label: string; base: number; sim?: number };

const compact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const axisLabel = (cents: number) => compact.format(Math.trunc(cents / 100));

function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as ChartRow;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{formatDayLabel(row.date)}</div>
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3 rounded-full bg-series-1" aria-hidden />
        <span className="text-muted-foreground">Saldo</span>
        <span className="ml-auto font-medium tabular-nums">{formatBRL(row.base)}</span>
      </div>
      {row.sim !== undefined && (
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full bg-series-2" aria-hidden />
          <span className="text-muted-foreground">Com a simulação</span>
          <span className="ml-auto font-medium tabular-nums">{formatBRL(row.sim)}</span>
        </div>
      )}
    </div>
  );
}

function BalanceChart({
  rows,
  today,
  showToday,
  simulated,
}: {
  rows: ChartRow[];
  today: ISODate;
  showToday: boolean;
  simulated: boolean;
}) {
  const todayLabel = rows.find((r) => r.date === today)?.label;
  return (
    <div className="space-y-2">
      {simulated && (
        <div className="flex gap-4 text-xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-series-1" />
            Saldo previsto
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full border-t-2 border-dashed border-series-2" />
            Com a simulação
          </span>
        </div>
      )}
      <div
        className="h-52 w-full md:h-64"
        role="img"
        aria-label="Gráfico do saldo da conta em cada dia do mês"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tickFormatter={axisLabel}
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <ReferenceLine y={0} stroke="var(--expense)" strokeDasharray="4 4" strokeOpacity={0.7} />
            {showToday && todayLabel && (
              <ReferenceLine
                x={todayLabel}
                stroke="var(--muted-foreground)"
                strokeDasharray="2 3"
                label={{
                  value: 'hoje',
                  position: 'insideTopRight',
                  fill: 'var(--muted-foreground)',
                  fontSize: 11,
                }}
              />
            )}
            <Tooltip
              content={ChartTooltip}
              cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            <Line
              type="stepAfter"
              dataKey="base"
              name="Saldo previsto"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: 'var(--series-1)', stroke: 'var(--card)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {simulated && (
              <Line
                type="stepAfter"
                dataKey="sim"
                name="Com a simulação"
                stroke="var(--series-2)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 5, fill: 'var(--series-2)', stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────── lista dia a dia ───────────

const SOURCE_BADGE: Record<CashFlow['source'], { label: string; className: string } | null> = {
  REALIZED: null,
  PENDING: { label: 'A pagar', className: 'bg-warning/20 text-warning-text' },
  SCHEDULED: { label: 'Agendado', className: 'bg-primary/10 text-primary' },
  INVOICE: { label: 'Fatura', className: 'bg-muted text-muted-foreground' },
  LOAN: { label: 'Empréstimo', className: 'bg-muted text-muted-foreground' },
  FIXED: { label: 'Fixo', className: 'bg-muted text-muted-foreground' },
  VARIABLE: { label: 'Estimado', className: 'bg-muted text-muted-foreground' },
  SUBSCRIPTION: { label: 'Assinatura', className: 'bg-muted text-muted-foreground' },
  SIMULATION: { label: 'Simulação', className: 'bg-series-2/15 text-foreground' },
};

function badgeFor(f: CashFlow) {
  if (f.overdue) return { label: 'Atrasado', className: 'bg-expense/15 text-expense' };
  if (f.source === 'PENDING' && f.amountCents > 0)
    return { label: 'A receber', className: 'bg-income/15 text-income' };
  return SOURCE_BADGE[f.source];
}

function FlowRow({ f }: { f: CashFlow }) {
  const badge = badgeFor(f);
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{f.label}</span>
          {badge && (
            <span
              className={cn('shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium', badge.className)}
            >
              {badge.label}
            </span>
          )}
        </span>
        {(f.detail || f.overdue) && (
          <span className="block truncate text-xs text-muted-foreground">
            {f.overdue ? `Venceu em ${formatDateBR(f.originalDate)}` : f.detail}
            {f.overdue && f.detail ? ` · ${f.detail}` : ''}
            {f.source === 'SUBSCRIPTION' ? ` · cobra em ${shortDate(f.originalDate)}` : ''}
          </span>
        )}
      </span>
      <Amount
        cents={Math.abs(f.amountCents)}
        direction={f.amountCents >= 0 ? 'in' : 'out'}
        className={cn('shrink-0 text-sm', f.source === 'REALIZED' && 'opacity-80')}
      />
    </>
  );
  return (
    <li data-testid="forecast-flow">
      {f.href ? (
        <Link
          href={f.href}
          className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-2 py-1.5">{body}</div>
      )}
    </li>
  );
}

function DayBlock({ day, today }: { day: ForecastDay; today: ISODate }) {
  const isToday = day.date === today;
  const negative = day.closingCents < 0;
  return (
    <li
      data-testid="forecast-day"
      data-date={day.date}
      className={cn(
        'rounded-xl border bg-card',
        isToday && 'border-primary/40',
        negative && 'border-expense/40',
      )}
    >
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5 pb-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {formatDayLabel(day.date)}
          {isToday && (
            <span className="rounded-full bg-primary px-1.5 py-px text-[11px] text-primary-foreground">
              Hoje
            </span>
          )}
        </span>
        <span className="text-right">
          <span className="block text-[11px] text-muted-foreground">Saldo no fim do dia</span>
          <Amount
            cents={day.closingCents}
            className={cn('text-sm font-semibold', negative && 'text-expense')}
            data-testid="forecast-day-balance"
          />
        </span>
      </div>
      <ul className="px-1 pb-1.5">
        {day.flows.map((f) => (
          <FlowRow key={f.key} f={f} />
        ))}
      </ul>
    </li>
  );
}

/** Dias seguidos sem movimento viram uma linha só ("27 a 29/11 · sem movimento"). */
function QuietRun({ days, today }: { days: ForecastDay[]; today: ISODate }) {
  const first = days[0]!;
  const last = days.at(-1)!;
  const negative = last.closingCents < 0;
  const hasToday = days.some((d) => d.date === today);
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-1 text-xs text-muted-foreground">
      <span>
        {days.length === 1 ? shortDate(first.date) : `${shortDate(first.date)} a ${shortDate(last.date)}`} ·
        sem movimento{hasToday ? ' (hoje)' : ''}
      </span>
      <Amount cents={last.closingCents} className={cn(negative && 'text-expense')} />
    </li>
  );
}

function DayList({ days, today }: { days: ForecastDay[]; today: ISODate }) {
  const items: React.ReactNode[] = [];
  let quiet: ForecastDay[] = [];
  const flush = () => {
    if (quiet.length) items.push(<QuietRun key={`q-${quiet[0]!.date}`} days={quiet} today={today} />);
    quiet = [];
  };
  for (const d of days) {
    if (d.flows.length === 0) {
      quiet.push(d);
      continue;
    }
    flush();
    items.push(<DayBlock key={d.date} day={d} today={today} />);
  }
  flush();
  return <ul className="space-y-2">{items}</ul>;
}

// ─────────── simulação no cartão ───────────

const HORIZONS = [3, 6, 12] as const;

function CardRoomList({
  cards,
  points,
  onPick,
}: {
  cards: ForecastCardOption[];
  points: BalancePoint[];
  onPick: (id: string) => void;
}) {
  return (
    <ul className="divide-y">
      {cards.map((c) => {
        const due = c.dueDates[0]!;
        const room = pointsRoom(points, due);
        const low = lowestPoint(points, due);
        const limited = c.availableCents !== null && room !== null && c.availableCents < room;
        const value = room === null ? null : limited ? Math.max(0, c.availableCents!) : room;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
              data-testid="card-room"
            >
              <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-muted-foreground">
                  Compra hoje cai na fatura de {shortDate(due)}
                  {c.availableCents !== null && ` · limite livre ${formatBRL(c.availableCents)}`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] text-muted-foreground">À vista, até</span>
                {value === null ? (
                  <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <Amount
                    cents={value}
                    className={cn('text-sm font-semibold', value === 0 ? 'text-expense' : 'text-income')}
                  />
                )}
                {value === 0 && low && low.closingCents < 0 && (
                  <span className="block text-[11px] text-expense">
                    já fica negativa em {shortDate(low.date)}
                  </span>
                )}
                {limited && value !== 0 && (
                  <span className="block text-[11px] text-muted-foreground">pelo limite</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SimulationResult({
  charges,
  outside,
  basePoints,
  simPoints,
  card,
  amountCents,
  horizonEnd,
}: {
  charges: SimulatedCharge[];
  outside: SimulatedCharge[];
  basePoints: BalancePoint[];
  simPoints: BalancePoint[];
  card: ForecastCardOption;
  amountCents: Cents;
  horizonEnd: ISODate;
}) {
  const from = charges[0]!.date;
  const neg = firstNegativePoint(simPoints, from);
  const lowSim = lowestPoint(simPoints, from);
  const lowBase = lowestPoint(basePoints, from);
  const overLimit = card.availableCents !== null && amountCents > card.availableCents;
  return (
    <div
      className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm"
      data-testid="simulation-result"
      aria-live="polite"
    >
      {neg ? (
        <p className="flex gap-2 font-medium text-expense">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            A conta fica negativa em {formatDateBR(neg.date)} ({formatBRL(neg.closingCents)}).
          </span>
        </p>
      ) : (
        <p className="flex gap-2 font-medium text-income">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>A conta continua positiva até {formatDateBR(horizonEnd)}.</span>
        </p>
      )}
      {lowSim && lowBase && (
        <p className="text-muted-foreground">
          Menor saldo depois da 1ª parcela:{' '}
          <Amount cents={lowSim.closingCents} className="font-medium text-foreground" /> em{' '}
          {shortDate(lowSim.date)} (sem a compra: {formatBRL(lowBase.closingCents)}).
        </p>
      )}
      {overLimit && (
        <p className="flex gap-2 text-warning-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Passa do limite livre do cartão ({formatBRL(card.availableCents!)}).
        </p>
      )}
      <ul className="space-y-0.5 text-xs">
        {[...charges, ...outside].map((c) => (
          <li key={c.label} className="flex justify-between gap-2">
            <span className="text-muted-foreground">
              {c.label} · fatura de {formatDateBR(c.date)}
            </span>
            <Amount cents={c.amountCents} />
          </li>
        ))}
      </ul>
      {outside.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {outside.length === 1 ? 'Uma parcela vence' : `${outside.length} parcelas vencem`} depois de{' '}
          {formatDateBR(horizonEnd)} e não entram no cálculo.
        </p>
      )}
    </div>
  );
}

// ─────────── tela ───────────

export function CashForecastExplorer({
  month,
  today,
  viewDays,
  points,
  cards,
}: {
  month: ISODate;
  today: ISODate;
  /** os dias do mês da tela, com os movimentos */
  viewDays: ForecastDay[];
  /** saldo de fim de dia de hoje até o fim do horizonte (para a folga e a simulação) */
  points: BalancePoint[];
  cards: ForecastCardOption[];
}) {
  const current = monthStart(today);
  const isPast = compareDates(month, current) < 0;
  const isCurrent = month === current;
  const defaultCard = cards.find((c) => !c.isAdditional) ?? cards[0];

  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(6);
  const [cardId, setCardId] = useState(defaultCard?.id ?? '');
  const [amount, setAmount] = useState('');
  const [installments, setInstallments] = useState(1);
  const [pastOpen, setPastOpen] = useState(false);

  const card = cards.find((c) => c.id === cardId) ?? defaultCard;
  const lastMonth = points.length ? monthStart(points.at(-1)!.date) : current;
  const horizonMonth = addMonths(current, horizon);
  const horizonEnd = monthEnd(compareDates(horizonMonth, lastMonth) > 0 ? lastMonth : horizonMonth);
  const horizonPoints = useMemo(
    () => points.filter((p) => compareDates(p.date, horizonEnd) <= 0),
    [points, horizonEnd],
  );

  const parsed = amount ? tryParseBRL(amount) : null;
  const amountCents = parsed?.ok && parsed.value > 0 ? parsed.value : 0;

  const sim = useMemo(() => {
    if (!card || amountCents < installments) return null;
    const all = purchaseCharges(
      amountCents,
      card.dueDates.slice(0, installments),
      `Simulação · ${card.name}`,
    );
    const charges = all.filter((c) => compareDates(c.date, horizonEnd) <= 0);
    const outside = all.filter((c) => compareDates(c.date, horizonEnd) > 0);
    if (charges.length === 0) return null;
    const simPoints = shiftBalances(horizonPoints, charges);
    // os dias do mês da tela: as parcelas do próprio mês viram movimentos; as de antes baixam a abertura
    const from = viewDays[0]!.date;
    const to = viewDays.at(-1)!.date;
    const before = charges
      .filter((c) => compareDates(c.date, from) < 0)
      .reduce((s, c) => s + c.amountCents, 0);
    const inMonth = charges.filter((c) => compareDates(c.date, from) >= 0 && compareDates(c.date, to) <= 0);
    const days = simulate(viewDays, inMonth).days.map((d) => ({
      ...d,
      openingCents: d.openingCents - before,
      closingCents: d.closingCents - before,
    }));
    return { charges, outside, simPoints, days };
  }, [card, amountCents, installments, horizonEnd, horizonPoints, viewDays]);

  const days = sim?.days ?? viewDays;
  const watchFrom = isCurrent ? today : days[0]!.date;
  const low = isPast ? null : lowestFrom(days, watchFrom);
  const neg = isPast ? null : firstNegativeFrom(days, watchFrom);
  const end = days.at(-1)!;

  const chartRows: ChartRow[] = viewDays.map((d, i) => ({
    date: d.date,
    label: d.date.slice(8),
    base: d.closingCents,
    ...(sim ? { sim: days[i]!.closingCents } : {}),
  }));

  const pastDays = isCurrent ? days.filter((d) => compareDates(d.date, today) < 0) : [];
  const nextDays = isCurrent ? days.filter((d) => compareDates(d.date, today) >= 0) : days;

  return (
    <div className="space-y-4">
      <Card className="gap-3 py-4">
        <CardContent className="space-y-3 px-4">
          <BalanceChart rows={chartRows} today={today} showToday={isCurrent} simulated={Boolean(sim)} />
          {!isPast && (
            <div className="grid gap-2 sm:grid-cols-2">
              {neg ? (
                <div
                  className="flex gap-2 rounded-lg bg-expense/10 px-3 py-2 text-sm text-expense"
                  data-testid="forecast-negative"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium">Fica negativo em {formatDateBR(neg.date)}</span>
                    <span className="block text-xs">
                      Saldo previsto no fim do dia: {formatBRL(neg.closingCents)}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="flex gap-2 rounded-lg bg-income/10 px-3 py-2 text-sm text-income">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="font-medium">
                    {sim ? 'Com a simulação, n' : 'N'}enhum dia negativo
                    {isCurrent ? ' até o fim do mês' : ' neste mês'}
                  </span>
                </div>
              )}
              {low && (
                <div
                  className="flex gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                  data-testid="forecast-lowest"
                >
                  <CalendarCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="text-muted-foreground">
                      Menor saldo{isCurrent ? ' daqui até o fim do mês' : ''}
                    </span>
                    <span className="block font-medium">
                      <Amount cents={low.cents} className={cn(low.cents < 0 && 'text-expense')} /> em{' '}
                      {formatDateBR(low.date)}
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}
          {sim && (
            <p className="text-sm text-muted-foreground">
              Com a simulação, o mês termina em{' '}
              <Amount
                cents={end.closingCents}
                className={cn('font-medium text-foreground', end.closingCents < 0 && 'text-expense')}
              />
              .
            </p>
          )}
        </CardContent>
      </Card>

      {!isPast && cards.length > 0 && card && (
        <Card className="gap-3 py-4" id="cartao">
          <CardContent className="space-y-3 px-4">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 font-semibold">
                <Sparkles className="size-4 text-primary" aria-hidden /> Posso gastar no cartão?
              </h2>
              <p className="text-xs text-muted-foreground">
                Quanto dá para gastar hoje sem a conta ficar negativa em nenhum dia, do vencimento da fatura
                até {formatMonthLabel(monthStart(horizonEnd))}. Nada é gravado.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Até quando olhar">
                {HORIZONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHorizon(h)}
                    aria-pressed={horizon === h}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      horizon === h ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {h} meses
                  </button>
                ))}
              </div>
            </div>

            <CardRoomList cards={cards} points={horizonPoints} onPick={setCardId} />

            <div className="space-y-3 border-t pt-3">
              <h3 className="text-sm font-medium">Simular uma compra</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="col-span-2 space-y-1 sm:col-span-1">
                  <Label htmlFor="sim-card">Cartão</Label>
                  <NativeSelect id="sim-card" value={card.id} onChange={(e) => setCardId(e.target.value)}>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sim-amount">Valor</Label>
                  <MoneyInput id="sim-amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sim-installments">Parcelas</Label>
                  <NativeSelect
                    id="sim-installments"
                    value={installments}
                    onChange={(e) => setInstallments(Number(e.target.value))}
                  >
                    {card.dueDates.map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i === 0 ? 'À vista' : `${i + 1}x`}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              {amountCents > 0 && amountCents < installments && (
                <p className="text-xs text-expense">Cada parcela precisa ter pelo menos R$ 0,01.</p>
              )}
              {sim && (
                <SimulationResult
                  charges={sim.charges}
                  outside={sim.outside}
                  basePoints={horizonPoints}
                  simPoints={sim.simPoints}
                  card={card}
                  amountCents={amountCents}
                  horizonEnd={horizonEnd}
                />
              )}
              {amount && (
                <button
                  type="button"
                  onClick={() => setAmount('')}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Limpar simulação
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-2" aria-label="Dia a dia">
        <h2 className="font-semibold">Dia a dia</h2>
        {pastDays.length > 0 && (
          <div className="rounded-xl border bg-card">
            <button
              type="button"
              onClick={() => setPastOpen((v) => !v)}
              aria-expanded={pastOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
            >
              <span>
                <span className="font-medium">
                  Dias que já passaram ({shortDate(pastDays[0]!.date)} a {shortDate(pastDays.at(-1)!.date)})
                </span>
                <span className="block text-xs text-muted-foreground">
                  Saldo real, com o que já foi pago e recebido
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Amount cents={pastDays.at(-1)!.closingCents} className="text-sm" />
                <ChevronDown
                  className={cn('size-4 transition-transform', pastOpen && 'rotate-180')}
                  aria-hidden
                />
              </span>
            </button>
            {pastOpen && (
              <div className="border-t p-2">
                <DayList days={pastDays} today={today} />
              </div>
            )}
          </div>
        )}
        <DayList days={nextDays} today={today} />
      </section>

      {!isPast && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <ChevronRight className="size-3" aria-hidden />
          Compras futuras no cartão e gastos ainda não lançados não entram; o variável é a estimativa do
          cadastro.
        </p>
      )}
    </div>
  );
}
