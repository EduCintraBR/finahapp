/**
 * Previsto dia a dia (D94): o saldo da conta de cada dia, do 1º dia do mês atual até o fim do horizonte, a partir
 * dos movimentos (`CashFlow`) que mexem no saldo. Regras puras, sem banco e sem "hoje" implícito.
 *
 *   saldo do fim do dia = saldo do fim do dia anterior + Σ movimentos do dia
 *
 * - Até hoje, os movimentos são os lançamentos pagos (saldo real, mesma fórmula de getAccountBalance).
 * - De hoje em diante, o que ainda vai acontecer: pendentes no vencimento, agendados na data, o que falta pagar de
 *   cada fatura no vencimento, e nos meses futuros os fixos e as assinaturas no cartão (calculados em memória).
 * - Atrasados (venceram e não tiveram baixa) caem HOJE (`flowDate`): o previsto supõe que serão pagos agora.
 * - O mês seguinte começa no saldo previsto do fim do anterior (encadeado).
 */
import { buildInstallments } from '../card/purchases';
import { addDays, compareDates, monthStart, type ISODate } from '../dates';
import { assertCents, MoneyError, type Cents } from '../money';

export type FlowSource =
  /** já aconteceu: lançamento pago com data até hoje (saldo real) */
  | 'REALIZED'
  /** conta a pagar ou receita a receber, no vencimento */
  | 'PENDING'
  /** pago com data futura (D67): entra sozinho no dia */
  | 'SCHEDULED'
  /** o que falta pagar da fatura, no vencimento */
  | 'INVOICE'
  /** parcela de empréstimo a pagar (D66) */
  | 'LOAN'
  /** fixo de mês futuro (ocorrência ainda não gerada) */
  | 'FIXED'
  /** recorrente de valor variável de mês futuro (estimativa) */
  | 'VARIABLE'
  /** assinatura no cartão ainda não cobrada, no vencimento da fatura em que vai cair (D39) */
  | 'SUBSCRIPTION'
  /** compra simulada no cartão (nada é gravado) */
  | 'SIMULATION';

export type CashFlow = {
  /** chave estável para a lista */
  key: string;
  /** dia em que o dinheiro mexe no saldo */
  date: ISODate;
  /** data original: vencimento, data do lançamento ou da cobrança */
  originalDate: ISODate;
  /** assinado: + entra na conta, − sai */
  amountCents: Cents;
  source: FlowSource;
  /** venceu antes de hoje e não teve baixa: foi trazido para hoje */
  overdue: boolean;
  label: string;
  /** categoria, cartão, "estimado"... */
  detail: string | null;
  href: string | null;
};

export type ForecastDay = {
  date: ISODate;
  openingCents: Cents;
  inCents: Cents;
  /** positivo: o que sai no dia */
  outCents: Cents;
  closingCents: Cents;
  flows: CashFlow[];
};

export type MonthForecast = {
  month: ISODate;
  /** saldo no fim do dia anterior ao 1º dia (no mês futuro: o previsto do fim do mês anterior) */
  openingCents: Cents;
  closingCents: Cents;
  inCents: Cents;
  outCents: Cents;
  days: ForecastDay[];
};

/** Dia em que um pendente pesa no previsto: o vencimento, ou hoje se já venceu (atrasado). */
export function flowDate(dueDate: ISODate, today: ISODate): ISODate {
  return compareDates(dueDate, today) < 0 ? today : dueDate;
}

/** Um pendente venceu antes de hoje e não teve baixa. */
export function isOverdue(dueDate: ISODate, today: ISODate): boolean {
  return compareDates(dueDate, today) < 0;
}

/** Ordem dentro do dia: o que já aconteceu, depois entradas, depois saídas (maior primeiro), depois o rótulo. */
function byDayOrder(a: CashFlow, b: CashFlow): number {
  const realized = Number(b.source === 'REALIZED') - Number(a.source === 'REALIZED');
  if (realized !== 0) return realized;
  const sign = Number(b.amountCents > 0) - Number(a.amountCents > 0);
  if (sign !== 0) return sign;
  const size = Math.abs(b.amountCents) - Math.abs(a.amountCents);
  if (size !== 0) return size;
  return a.label.localeCompare(b.label, 'pt-BR');
}

/**
 * Todos os dias de `from` a `to` (inclusive), cada um com o saldo de abertura, os movimentos e o saldo de
 * fechamento. Movimento fora do intervalo é erro de quem chamou (nunca é descartado em silêncio).
 */
export function buildDays(
  from: ISODate,
  to: ISODate,
  openingCents: Cents,
  flows: readonly CashFlow[],
): ForecastDay[] {
  assertCents(openingCents, 'saldo de partida');
  if (compareDates(from, to) > 0) throw new Error(`Intervalo inválido: ${from} > ${to}.`);
  const byDate = new Map<ISODate, CashFlow[]>();
  for (const f of flows) {
    assertCents(f.amountCents, f.label);
    if (compareDates(f.date, from) < 0 || compareDates(f.date, to) > 0) {
      throw new Error(`Movimento "${f.label}" em ${f.date} fora do intervalo ${from}–${to}.`);
    }
    const list = byDate.get(f.date);
    if (list) list.push(f);
    else byDate.set(f.date, [f]);
  }
  const days: ForecastDay[] = [];
  let balance = openingCents;
  for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) {
    const dayFlows = (byDate.get(d) ?? []).sort(byDayOrder);
    let inCents = 0;
    let outCents = 0;
    for (const f of dayFlows) {
      if (f.amountCents >= 0) inCents += f.amountCents;
      else outCents -= f.amountCents;
    }
    const opening = balance;
    balance = opening + inCents - outCents;
    days.push({ date: d, openingCents: opening, inCents, outCents, closingCents: balance, flows: dayFlows });
  }
  return days;
}

/** Os dias agrupados por mês, encadeados: o mês seguinte abre no fechamento do anterior. */
export function groupByMonth(days: readonly ForecastDay[]): MonthForecast[] {
  const months: MonthForecast[] = [];
  for (const day of days) {
    const m = monthStart(day.date);
    let cur = months.at(-1);
    if (!cur || cur.month !== m) {
      cur = {
        month: m,
        openingCents: day.openingCents,
        closingCents: day.openingCents,
        inCents: 0,
        outCents: 0,
        days: [],
      };
      months.push(cur);
    }
    cur.days.push(day);
    cur.inCents += day.inCents;
    cur.outCents += day.outCents;
    cur.closingCents = day.closingCents;
  }
  return months;
}

/** Menor saldo de fim de dia a partir de `from` (o primeiro dia em que ele acontece). null = nenhum dia. */
export function lowestFrom(
  days: readonly ForecastDay[],
  from: ISODate,
): { date: ISODate; cents: Cents } | null {
  let low: { date: ISODate; cents: Cents } | null = null;
  for (const d of days) {
    if (compareDates(d.date, from) < 0) continue;
    if (!low || d.closingCents < low.cents) low = { date: d.date, cents: d.closingCents };
  }
  return low;
}

/** Primeiro dia, a partir de `from`, em que o saldo fecha negativo. */
export function firstNegativeFrom(days: readonly ForecastDay[], from: ISODate): ForecastDay | null {
  return days.find((d) => compareDates(d.date, from) >= 0 && d.closingCents < 0) ?? null;
}

/**
 * Quanto um gasto que só sai da conta em `from` (ex.: o vencimento da fatura) pode ter sem deixar o saldo
 * negativo em nenhum dia de `from` até o fim do horizonte: o menor saldo desse trecho (0 se já fica negativo).
 * null = `from` está depois do horizonte (não dá para saber).
 */
export function spendingRoom(days: readonly ForecastDay[], from: ISODate): Cents | null {
  const low = lowestFrom(days, from);
  return low ? Math.max(0, low.cents) : null;
}

export type SimulatedCharge = { date: ISODate; amountCents: Cents; label: string };

/**
 * Compra simulada no cartão: as parcelas (Σ = total, resto na 1ª, invariante 4) saem da conta no vencimento das
 * faturas em que cairiam (`dueDates[i]` = vencimento da fatura da parcela i+1).
 */
export function purchaseCharges(
  totalCents: Cents,
  dueDates: readonly ISODate[],
  label: string,
): SimulatedCharge[] {
  assertCents(totalCents, 'valor da compra');
  if (totalCents <= 0) throw new MoneyError('O valor da compra precisa ser maior que zero.');
  const count = dueDates.length;
  return buildInstallments(totalCents, count).map((l, i) => ({
    date: dueDates[i]!,
    amountCents: l.amountCents,
    label: count === 1 ? label : `${label} (${l.number}/${count})`,
  }));
}

/**
 * Os mesmos dias com as saídas simuladas, recalculando o saldo dia a dia a partir do 1º. Saída depois do último
 * dia do horizonte fica de fora (`outside`), para a tela avisar.
 */
export function simulate(
  days: readonly ForecastDay[],
  charges: readonly SimulatedCharge[],
): { days: ForecastDay[]; outside: SimulatedCharge[] } {
  if (days.length === 0) return { days: [], outside: [...charges] };
  const from = days[0]!.date;
  const to = days.at(-1)!.date;
  const inside: CashFlow[] = [];
  const outside: SimulatedCharge[] = [];
  charges.forEach((c, i) => {
    if (compareDates(c.date, from) < 0 || compareDates(c.date, to) > 0) {
      outside.push(c);
      return;
    }
    inside.push({
      key: `sim-${i}`,
      date: c.date,
      originalDate: c.date,
      amountCents: -c.amountCents,
      source: 'SIMULATION',
      overdue: false,
      label: c.label,
      detail: 'Simulação',
      href: null,
    });
  });
  const base = days.flatMap((d) => d.flows);
  return { days: buildDays(from, to, days[0]!.openingCents, [...base, ...inside]), outside };
}

// ─────────── composição do número (o "como chegamos nesse valor") ───────────

export type BreakdownKey =
  | 'realizedIn'
  | 'realizedOut'
  | 'overdueIn'
  | 'overdueOut'
  | 'pendingIn'
  | 'pendingOut'
  | 'scheduledIn'
  | 'scheduledOut'
  | 'invoices'
  | 'loans'
  | 'fixedIn'
  | 'fixedOut'
  | 'variableOut'
  | 'subscriptions'
  | 'simulation';

/** De que parte do cálculo um movimento é (entradas e saídas sempre separadas). */
export function breakdownKey(f: CashFlow): BreakdownKey {
  const isIn = f.amountCents > 0;
  if (f.source === 'REALIZED') return isIn ? 'realizedIn' : 'realizedOut';
  if (f.overdue) return isIn ? 'overdueIn' : 'overdueOut';
  switch (f.source) {
    case 'PENDING':
      return isIn ? 'pendingIn' : 'pendingOut';
    case 'SCHEDULED':
      return isIn ? 'scheduledIn' : 'scheduledOut';
    case 'INVOICE':
      return 'invoices';
    case 'LOAN':
      return 'loans';
    case 'FIXED':
      return isIn ? 'fixedIn' : 'fixedOut';
    case 'VARIABLE':
      return isIn ? 'fixedIn' : 'variableOut';
    case 'SUBSCRIPTION':
      return 'subscriptions';
    case 'SIMULATION':
      return 'simulation';
  }
}

/**
 * Σ assinada por parte, de `from` em diante (ou do mês inteiro). Σ de todas as partes = fechamento − abertura do
 * trecho, então a tela sempre "fecha a conta".
 */
export function breakdown(
  days: readonly ForecastDay[],
  from?: ISODate,
): Partial<Record<BreakdownKey, Cents>> {
  const out: Partial<Record<BreakdownKey, Cents>> = {};
  for (const d of days) {
    if (from && compareDates(d.date, from) < 0) continue;
    for (const f of d.flows) {
      const k = breakdownKey(f);
      out[k] = (out[k] ?? 0) + f.amountCents;
    }
  }
  return out;
}

// ─────────── série leve para a tela (simulação no navegador) ───────────

export type BalancePoint = { date: ISODate; closingCents: Cents };

/** Só a data e o saldo de fim de dia (o que a simulação precisa para o horizonte inteiro). */
export function toPoints(days: readonly ForecastDay[]): BalancePoint[] {
  return days.map((d) => ({ date: d.date, closingCents: d.closingCents }));
}

/**
 * Mesmo resultado de `simulate` só nos saldos: cada dia perde a soma das saídas simuladas até ele. Usado no
 * navegador, onde a série do horizonte vai sem os movimentos.
 */
export function shiftBalances(
  points: readonly BalancePoint[],
  charges: readonly SimulatedCharge[],
): BalancePoint[] {
  const sorted = [...charges].sort((a, b) => compareDates(a.date, b.date));
  let i = 0;
  let acc = 0;
  return points.map((p) => {
    while (i < sorted.length && compareDates(sorted[i]!.date, p.date) <= 0) acc += sorted[i++]!.amountCents;
    return { date: p.date, closingCents: p.closingCents - acc };
  });
}

/** Menor saldo da série a partir de `from` (null = nenhum ponto). */
export function lowestPoint(points: readonly BalancePoint[], from: ISODate): BalancePoint | null {
  let low: BalancePoint | null = null;
  for (const p of points) {
    if (compareDates(p.date, from) < 0) continue;
    if (!low || p.closingCents < low.closingCents) low = p;
  }
  return low;
}

/** Folga na série (ver spendingRoom). */
export function pointsRoom(points: readonly BalancePoint[], from: ISODate): Cents | null {
  const low = lowestPoint(points, from);
  return low ? Math.max(0, low.closingCents) : null;
}

/** Primeiro ponto negativo a partir de `from`. */
export function firstNegativePoint(points: readonly BalancePoint[], from: ISODate): BalancePoint | null {
  return points.find((p) => compareDates(p.date, from) >= 0 && p.closingCents < 0) ?? null;
}
