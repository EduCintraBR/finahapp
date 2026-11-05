/**
 * Medida dos produtos da Casa (D82): unidades, gramas ou mililitros, SEMPRE inteiros (como os centavos).
 * kg e L existem só na digitação e na apresentação; a conversão é feita sobre o texto, nunca com float.
 */

export type Measure = 'UNIT' | 'WEIGHT' | 'VOLUME';
export type MeasureUnit = 'un' | 'g' | 'kg' | 'ml' | 'L';

/** Unidades de digitação de cada medida; `factor` = quantas unidades-base (un, g, ml) cabem em uma. */
export const MEASURE_UNITS: Record<Measure, { unit: MeasureUnit; factor: 1 | 1000 }[]> = {
  UNIT: [{ unit: 'un', factor: 1 }],
  WEIGHT: [
    { unit: 'kg', factor: 1000 },
    { unit: 'g', factor: 1 },
  ],
  VOLUME: [
    { unit: 'L', factor: 1000 },
    { unit: 'ml', factor: 1 },
  ],
};

export const MEASURE_LABELS: Record<Measure, string> = {
  UNIT: 'Unidades',
  WEIGHT: 'Peso (kg, g)',
  VOLUME: 'Volume (L, ml)',
};

/** Teto de uma quantidade na unidade-base (1.000 t ou 1.000.000 L): bem abaixo de 2^53, sem surpresa de soma. */
export const MAX_BASE_AMOUNT = 1_000_000_000;

export type AmountResult = { ok: true; value: number } | { ok: false; error: string };

function factorOf(unit: MeasureUnit): 1 | 1000 {
  return unit === 'kg' || unit === 'L' ? 1000 : 1;
}

// kg e L: "1,8" · "1.8" · "12" (até 3 casas: o grama e o ml)
const THOUSANDTHS = /^(\d+)(?:[.,](\d{1,3}))?$/;
// un, g e ml: inteiros, com ponto de milhar opcional ("1.500")
const WHOLE = /^(\d{1,3}(?:\.\d{3})+|\d+)$/;

/**
 * Texto digitado → quantidade inteira na unidade-base. "1,8" kg → 1800 g; "500" g → 500 g; "2" un → 2.
 * Recusa zero, negativos, casas demais e números altos demais, com mensagem em pt-BR.
 */
export function tryParseAmount(input: string, unit: MeasureUnit): AmountResult {
  const s = input.replace(/\s/g, '');
  if (s === '') return { ok: false, error: 'Informe a quantidade.' };
  const factor = factorOf(unit);
  let value: number;
  if (factor === 1000) {
    const m = THOUSANDTHS.exec(s);
    if (!m) return { ok: false, error: `Quantidade inválida. Use, por exemplo, 1,5 ${unit}.` };
    const int = m[1]!.replace(/^0+(?=\d)/, '');
    if (int.length > 7) return { ok: false, error: 'Quantidade alta demais.' };
    value = Number(int) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  } else {
    const m = WHOLE.exec(s);
    if (!m) {
      return {
        ok: false,
        error: /[.,]\d{1,2}$/.test(s)
          ? `Em ${unit} a quantidade é um número inteiro.`
          : 'Quantidade inválida.',
      };
    }
    const digits = m[1]!.replace(/\./g, '').replace(/^0+(?=\d)/, '');
    if (digits.length > 10) return { ok: false, error: 'Quantidade alta demais.' };
    value = Number(digits);
  }
  if (value === 0) return { ok: false, error: 'A quantidade precisa ser maior que zero.' };
  if (value > MAX_BASE_AMOUNT) return { ok: false, error: 'Quantidade alta demais.' };
  return { ok: true, value };
}

const INT_FORMATTER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const intText = (n: number, grouping: boolean) => (grouping ? INT_FORMATTER.format(n) : String(n));

/**
 * Inteiro em milésimos → "1,8" / "1.250" / "0,5" (sem float: separa a parte inteira pela string). Sem `grouping`
 * (campos de formulário) sai "1250": em kg e L o ponto digitado é lido como vírgula.
 */
function thousandthsText(value: number, grouping: boolean): string {
  const int = Math.floor(value / 1000);
  const frac = String(value % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return frac ? `${intText(int, grouping)},${frac}` : intText(int, grouping);
}

/** Unidade em que um valor fica mais legível: kg/L a partir de 1.000 g/ml. */
export function displayUnit(measure: Measure, value: number): MeasureUnit {
  if (measure === 'UNIT') return 'un';
  const [big, small] = MEASURE_UNITS[measure];
  return Math.abs(value) >= 1000 ? big!.unit : small!.unit;
}

/** Valor na unidade pedida, só o número e sem ponto de milhar ("1,8", "1500"): para pré-preencher campos. */
export function amountInUnit(value: number, unit: MeasureUnit): string {
  return factorOf(unit) === 1000 ? thousandthsText(value, false) : String(value);
}

/** 1800 g → "1,8 kg"; 500 ml → "500 ml"; 12 un → "12 un". */
export function formatAmount(measure: Measure, value: number): string {
  const unit = displayUnit(measure, value);
  const text = factorOf(unit) === 1000 ? thousandthsText(value, true) : INT_FORMATTER.format(value);
  return `${text} ${unit}`;
}

/** Contagem de embalagens com o nome no plural simples ("1 pacote", "11 garrafas", "3 un"). */
export function formatPackages(count: number, packageName: string): string {
  const name = packageName.trim() || 'un';
  if (count === 1 || name === 'un') return `${INT_FORMATTER.format(count)} ${name}`;
  return `${INT_FORMATTER.format(count)} ${pluralize(name)}`;
}

/** Plural do nome da embalagem só na 1ª palavra ("garrafa PET" → "garrafas PET", "galão" → "galões"). */
export function pluralize(name: string): string {
  const [first = '', ...rest] = name.split(' ');
  const lower = first.toLowerCase();
  let plural: string;
  if (/ão$/.test(lower)) plural = first.replace(/ão$/i, 'ões');
  else if (/[aeiou]$/i.test(lower)) plural = `${first}s`;
  else if (/[rsz]$/i.test(lower)) plural = /s$/i.test(lower) ? first : `${first}es`;
  else if (/il$/i.test(lower)) plural = first.replace(/il$/i, 'is');
  else if (/l$/i.test(lower)) plural = first.replace(/l$/i, 'is');
  else if (/m$/i.test(lower)) plural = first.replace(/m$/i, 'ns');
  else plural = `${first}s`;
  return [plural, ...rest].join(' ');
}
