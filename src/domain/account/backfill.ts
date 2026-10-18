/**
 * Recuar o início do controle (D50): importar um extrato anterior ao saldo inicial.
 *
 * O saldo inicial é uma âncora ("nesta data o saldo era X"). Para aceitar lançamentos mais antigos, a âncora
 * recua: a data nova é o começo do arquivo e o saldo dessa data vem do próprio arquivo (saldo final do OFX
 * menos o movimento do período), nunca de um valor digitado. Em seguida confere com o saldo inicial atual:
 * se o arquivo é completo, o saldo dele na virada bate com o que o app já tinha.
 */
import { addDays, compareDates, formatDateBR, type ISODate } from '../dates';
import { formatBRL, type Cents } from '../money';

export type BackfillCheck =
  | { status: 'OK' }
  /** o saldo do arquivo na virada difere do saldo inicial atual: arquivo incompleto ou saldo inicial errado */
  | { status: 'MISMATCH'; fileBalanceCents: Cents; appOpeningCents: Cents; diffCents: Cents }
  /** o arquivo termina antes de a data de início atual: falta o período entre eles */
  | { status: 'GAP'; from: ISODate; to: ISODate }
  /** sem saldo no arquivo (CSV): não dá para conferir */
  | { status: 'UNVERIFIABLE' };

export type BackfillPlan = {
  newDate: ISODate;
  newOpeningCents: Cents;
  /** LEDGER: saldo vem do arquivo. CONTINUITY: parte do saldo inicial atual e desconta o movimento anterior. */
  method: 'LEDGER' | 'CONTINUITY';
  earlyLines: number;
  check: BackfillCheck;
  /** true = não pode seguir (MISMATCH, ou lacuna quando o saldo depende da continuidade) */
  blocking: boolean;
};

export type BackfillInput = {
  openingDate: ISODate;
  openingCents: Cents;
  fileStart: ISODate | null;
  fileEnd: ISODate | null;
  /** saldo do banco ao fim do arquivo (LEDGERBAL), se houver */
  ledgerCents: Cents | null;
  /** linhas do arquivo com o sinal do banco: entrada +, saída − */
  lines: readonly { date: ISODate; signedCents: Cents }[];
};

const sum = (xs: readonly { signedCents: Cents }[]) => xs.reduce((s, l) => s + l.signedCents, 0);

/** null = nada anterior ao início do controle. */
export function planBackfill(i: BackfillInput): BackfillPlan | null {
  const early = i.lines.filter((l) => compareDates(l.date, i.openingDate) < 0);
  if (early.length === 0) return null;

  const firstLine = i.lines.reduce(
    (min, l) => (compareDates(l.date, min) < 0 ? l.date : min),
    i.lines[0]!.date,
  );
  const newDate = i.fileStart && compareDates(i.fileStart, firstLine) < 0 ? i.fileStart : firstLine;
  const dayBeforeOpening = addDays(i.openingDate, -1);
  const gap: BackfillCheck | null =
    i.fileEnd && compareDates(i.fileEnd, dayBeforeOpening) < 0
      ? { status: 'GAP', from: addDays(i.fileEnd, 1), to: dayBeforeOpening }
      : null;

  if (i.ledgerCents !== null) {
    const newOpeningCents = i.ledgerCents - sum(i.lines);
    let check: BackfillCheck = gap ?? { status: 'OK' };
    if (!gap) {
      // saldo do arquivo na virada = saldo final − o que o arquivo traz de 01/10 em diante
      const fileBalanceCents =
        i.ledgerCents - sum(i.lines.filter((l) => compareDates(l.date, i.openingDate) >= 0));
      if (fileBalanceCents !== i.openingCents) {
        check = {
          status: 'MISMATCH',
          fileBalanceCents,
          appOpeningCents: i.openingCents,
          diffCents: fileBalanceCents - i.openingCents,
        };
      }
    }
    return {
      newDate,
      newOpeningCents,
      method: 'LEDGER',
      earlyLines: early.length,
      check,
      blocking: check.status === 'MISMATCH',
    };
  }

  return {
    newDate,
    newOpeningCents: i.openingCents - sum(early),
    method: 'CONTINUITY',
    earlyLines: early.length,
    check: gap ?? { status: 'UNVERIFIABLE' },
    blocking: gap !== null,
  };
}

/** Por que o recuo não pode seguir (mensagem em pt-BR), ou null se pode. */
export function backfillBlockMessage(plan: BackfillPlan, openingDate: ISODate): string | null {
  if (!plan.blocking) return null;
  const c = plan.check;
  if (c.status === 'MISMATCH') {
    return (
      `O saldo do arquivo na virada para ${formatDateBR(openingDate)} (${formatBRL(c.fileBalanceCents)}) não bate com o ` +
      `saldo inicial do app (${formatBRL(c.appOpeningCents)}): diferença de ${formatBRL(c.diffCents)}. ` +
      'O arquivo pode estar incompleto, ou o saldo inicial pode estar errado (Ajustes → Saldo inicial).'
    );
  }
  if (c.status === 'GAP') {
    return (
      `Faltam os lançamentos de ${formatDateBR(c.from)} a ${formatDateBR(c.to)}, entre o fim do arquivo e o início do controle. ` +
      `Exporte o período até ${formatDateBR(c.to)} e importe de novo.`
    );
  }
  return null;
}
