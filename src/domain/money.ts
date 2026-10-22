/**
 * Dinheiro do Finah: SEMPRE inteiro em centavos.
 * Nada aqui usa float para cálculo; a conversão para reais acontece só em `formatBRL`,
 * e mesmo ela passa uma string decimal exata para o Intl (sem divisão em ponto flutuante).
 */

/** Valor monetário em centavos (inteiro seguro; pode ser negativo, ex.: crédito na fatura). */
export type Cents = number;

/** Limite de parcelas aceito pelo banco (CHECK plan_count). */
export const MAX_INSTALLMENTS = 72;

/** Maior valor aceito no input: R$ 99.999.999.999,99 (11 dígitos de reais, bem abaixo de 2^53 centavos). */
const MAX_INTEGER_DIGITS = 11;

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertCents(value: number, label = 'valor'): asserts value is Cents {
  if (!isCents(value)) throw new MoneyError(`O ${label} precisa ser um número inteiro de centavos.`);
}

/** Soma de centavos, garantindo que o resultado continua um inteiro seguro. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total, 'total');
  return total;
}

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Representação decimal exata, ex.: 123456 → "1234.56", -5 → "-0.05". */
export function centsToDecimalString(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = String(Math.abs(cents)).padStart(3, '0');
  const int = abs.slice(0, -2);
  const dec = abs.slice(-2);
  return `${negative ? '-' : ''}${int}.${dec}`;
}

/** 123456 → "R$ 1.234,56" (com espaço não separável, como o Intl gera). */
export function formatBRL(cents: Cents): string {
  return BRL_FORMATTER.format(centsToDecimalString(cents) as Intl.StringNumericLiteral);
}

// "1.234,56" · "1234,56" · "0,5"
const COMMA_DECIMAL = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;
// "1234.56" · "1234.5"
const DOT_DECIMAL = /^(\d+)\.(\d{1,2})$/;
// "1.234" · "1.234.567" (ponto como milhar quando seguido de exatamente 3 dígitos)
const DOT_THOUSANDS = /^(\d{1,3}(?:\.\d{3})+)$/;
const INTEGER = /^(\d+)$/;

export type ParseResult = { ok: true; value: Cents } | { ok: false; error: string };

/**
 * Converte o texto digitado em centavos. Aceita "1.234,56", "1234,56", "1234.56", "1234",
 * "R$ 1.234,56" e sinal negativo ("-12,30"). Rejeita mais de 2 casas decimais e agrupamentos inválidos.
 */
export function tryParseBRL(input: string): ParseResult {
  let s = input.replace(/[\s ]/g, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (/^r\$/i.test(s)) s = s.slice(2);
  if (!negative && s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '') return { ok: false, error: 'Informe um valor.' };

  let intPart: string;
  let decPart = '';
  let m: RegExpExecArray | null;
  if ((m = COMMA_DECIMAL.exec(s))) {
    intPart = m[1]!;
    decPart = m[2]!;
  } else if ((m = DOT_DECIMAL.exec(s))) {
    intPart = m[1]!;
    decPart = m[2]!;
  } else if ((m = DOT_THOUSANDS.exec(s)) || (m = INTEGER.exec(s))) {
    intPart = m[1]!;
  } else {
    return { ok: false, error: 'Valor inválido. Use o formato 1.234,56.' };
  }

  const digits = intPart.replace(/\./g, '').replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_INTEGER_DIGITS) return { ok: false, error: 'Valor alto demais.' };

  const cents = Number(digits) * 100 + Number(decPart.padEnd(2, '0'));
  if (cents === 0) return { ok: true, value: 0 }; // evita -0
  return { ok: true, value: negative ? -cents : cents };
}

export function parseBRL(input: string): Cents {
  const r = tryParseBRL(input);
  if (!r.ok) throw new MoneyError(r.error);
  return r.value;
}

/**
 * Divide o total em parcelas iguais; o resto dos centavos vai na 1ª parcela.
 * R$ 100,00 em 3x → [3334, 3333, 3333]. Σ parcelas = total, sempre.
 */
export function splitInstallments(total: Cents, count: number): Cents[] {
  assertCents(total, 'valor total');
  if (total <= 0) throw new MoneyError('O valor total precisa ser maior que zero.');
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    throw new MoneyError(`O número de parcelas precisa estar entre 1 e ${MAX_INSTALLMENTS}.`);
  }
  if (total < count) throw new MoneyError('Cada parcela precisa ter pelo menos R$ 0,01.');

  const base = Math.floor(total / count);
  const rest = total - base * count;
  const parts = new Array<Cents>(count).fill(base);
  parts[0] = base + rest;
  return parts;
}

const DECIMAL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 → "1.234,56" (sem "R$"): valor para pré-preencher campos de formulário. */
export function formatDecimalBR(cents: Cents): string {
  return DECIMAL_FORMATTER.format(centsToDecimalString(cents) as Intl.StringNumericLiteral);
}

const MASK_MAX_DIGITS = 12;

/**
 * Máscara de valor "centavos primeiro", como nos apps de banco: só os dígitos digitados importam e a vírgula fica
 * sempre antes dos 2 últimos. "1" → "0,01", "12345" → "123,45", "123456789" → "1.234.567,89". Um "-" digitado
 * em qualquer lugar vira o sinal. Vazio fica vazio (o campo obrigatório continua acusando a falta do valor).
 * Só texto: nada de float; o servidor converte para centavos (parseBRL).
 */
export function maskMoneyInput(raw: string): string {
  const negative = raw.includes('-');
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, MASK_MAX_DIGITS);
  if (digits === '') return negative && raw.trim() !== '' ? '-' : '';
  const padded = digits.padStart(3, '0');
  const int = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${int},${padded.slice(-2)}`;
}
