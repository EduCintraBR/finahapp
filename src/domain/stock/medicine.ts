/**
 * Remédios e embalagem aberta da Casa (D88, D90): as formas, o que se conta solto e o planejamento do "Abri" (de
 * uma embalagem fechada nasce um lote aberto, com o total do produto intacto e a validade depois de aberto).
 */
import { addDays, compareDates, type ISODate } from '../dates';
import type { Measure } from './measure';
import { StockError } from './quantity';

export type MedicineForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SACHET'
  | 'SUPPOSITORY'
  | 'SYRUP'
  | 'DROPS'
  | 'SOLUTION'
  | 'OINTMENT'
  | 'CREAM'
  | 'SPRAY'
  | 'EYE_DROPS'
  | 'INJECTABLE'
  | 'OTHER';

/** `loose`: conta unidade solta depois de aberto; `unit`: o nome de cada uma ("comprimido"). */
export const MEDICINE_FORMS: readonly { value: MedicineForm; label: string; loose: boolean; unit: string }[] =
  [
    { value: 'TABLET', label: 'Comprimido', loose: true, unit: 'comprimido' },
    { value: 'CAPSULE', label: 'Cápsula', loose: true, unit: 'cápsula' },
    { value: 'SACHET', label: 'Sachê', loose: true, unit: 'sachê' },
    { value: 'SUPPOSITORY', label: 'Supositório', loose: true, unit: 'supositório' },
    { value: 'SYRUP', label: 'Xarope', loose: false, unit: 'frasco' },
    { value: 'DROPS', label: 'Gotas', loose: false, unit: 'frasco' },
    { value: 'SOLUTION', label: 'Solução', loose: false, unit: 'frasco' },
    { value: 'OINTMENT', label: 'Pomada', loose: false, unit: 'bisnaga' },
    { value: 'CREAM', label: 'Creme', loose: false, unit: 'bisnaga' },
    { value: 'SPRAY', label: 'Spray', loose: false, unit: 'frasco' },
    { value: 'EYE_DROPS', label: 'Colírio', loose: false, unit: 'frasco' },
    { value: 'INJECTABLE', label: 'Injetável', loose: false, unit: 'ampola' },
    { value: 'OTHER', label: 'Outra', loose: false, unit: 'un' },
  ];

const FORM_BY_VALUE = new Map(MEDICINE_FORMS.map((f) => [f.value, f]));

export const formLabel = (form: MedicineForm): string => FORM_BY_VALUE.get(form)!.label;

export function isLooseForm(form: MedicineForm | null): boolean {
  return form !== null && FORM_BY_VALUE.get(form)!.loose;
}

/** Validade depois de aberto: abertura + prazo, ou a validade da embalagem fechada se for antes. */
export function openedExpiry(
  openDate: ISODate,
  shelfLifeDays: number,
  closedExpiry: ISODate | null,
): ISODate {
  const afterOpen = addDays(openDate, shelfLifeDays);
  return closedExpiry && compareDates(closedExpiry, afterOpen) < 0 ? closedExpiry : afterOpen;
}

export type OpeningSource = {
  measure: Measure;
  form: MedicineForm | null;
  openShelfLifeDays: number | null;
  packageName: string;
  contentPerPackage: number | null;
  expiryDate: ISODate | null;
  origin: 'PURCHASE' | 'REPACK' | 'OPENED';
  /** embalagens do lote de origem agora */
  quantity: number;
};

export type OpeningPlan = {
  packageName: string;
  /** embalagens do lote aberto (as unidades soltas, ou 1) */
  packages: number;
  contentPerPackage: number | null;
  expiryDate: ISODate;
};

const MAX_NAME = 40;
const OPEN_SUFFIX = ' aberto';

/**
 * O lote aberto que nasce de 1 embalagem. Comprimido, cápsula, sachê e supositório em caixa com mais de 1 unidade
 * viram unidades soltas (a caixa de 10 comprimidos vira "10 comprimidos"); o resto vira 1 embalagem aberta do mesmo
 * conteúdo. Nos dois casos o total do produto não muda.
 */
export function planOpening(lot: OpeningSource, openDate: ISODate): OpeningPlan {
  if (lot.origin === 'OPENED') throw new StockError('Este lote já está aberto.');
  if (lot.quantity < 1) throw new StockError('Sem embalagem fechada neste lote para abrir.');
  if (!lot.openShelfLifeDays) {
    throw new StockError('Informe a validade depois de aberto no cadastro do produto para usar o "Abri".');
  }
  const expiryDate = openedExpiry(openDate, lot.openShelfLifeDays, lot.expiryDate);
  const content = lot.contentPerPackage;
  if (lot.measure === 'UNIT' && isLooseForm(lot.form) && content !== null && content > 1) {
    return {
      packageName: FORM_BY_VALUE.get(lot.form!)!.unit,
      packages: content,
      contentPerPackage: null,
      expiryDate,
    };
  }
  return {
    packageName: `${lot.packageName.slice(0, MAX_NAME - OPEN_SUFFIX.length)}${OPEN_SUFFIX}`,
    packages: 1,
    contentPerPackage: content,
    expiryDate,
  };
}
