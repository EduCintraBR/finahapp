'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  addStockLotAction,
  checkStockLotAction,
  countStockLotAction,
  createStockProductAction,
  repackStockAction,
  updateStockLotAction,
  updateStockProductAction,
  useStockAction,
} from '@/app/(app)/casa/actions';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActionDone } from '@/components/ui/sheet-action';
import { Textarea } from '@/components/ui/textarea';
import { MEDICINE_FORMS, type MedicineForm } from '@/domain/stock/medicine';
import {
  amountInUnit,
  MEASURE_LABELS,
  MEASURE_UNITS,
  type Measure,
  type MeasureUnit,
} from '@/domain/stock/measure';

export type Option = { id: string; name: string };
export type CategoryOption = Option & { parentId: string | null };
export type ProductOption = {
  id: string;
  name: string;
  categoryLabel: string;
  measure: Measure;
  defaultPackage: string | null;
  defaultContent: number | null;
  defaultLocationId: string | null;
};

const PACKAGE_SUGGESTIONS = [
  'pacote',
  'garrafa PET',
  'galão',
  'fardo',
  'caixa',
  'lata',
  'frasco',
  'saco',
  'pote',
  'rolo',
];

function PackageSuggestions() {
  return (
    <datalist id="stock-packages">
      {PACKAGE_SUGGESTIONS.map((p) => (
        <option key={p} value={p} />
      ))}
    </datalist>
  );
}

/** Unidade em que um valor guardado aparece no campo: kg/L quando dá número redondo ou passa de 1.000. */
function unitFor(measure: Measure, value: number | null): MeasureUnit {
  const [big, small] = MEASURE_UNITS[measure];
  if (!small) return big!.unit;
  if (value === null) return big!.unit;
  return value >= 1000 ? big!.unit : small.unit;
}

/** Campo de quantidade com a unidade ao lado (kg/g, L/ml, un). O texto vai como está; o servidor converte. */
function AmountField({
  id,
  label,
  hint,
  measure,
  name,
  unitName,
  value,
  required,
}: {
  id: string;
  label: string;
  hint?: string;
  measure: Measure;
  name: string;
  unitName: string;
  /** valor guardado (na unidade-base) para pré-preencher */
  value?: number | null;
  required?: boolean;
}) {
  const units = MEASURE_UNITS[measure];
  const initialUnit = unitFor(measure, value ?? null);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <Input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          required={required}
          defaultValue={value ? amountInUnit(value, initialUnit) : undefined}
          className="min-w-0 flex-1 text-base tabular-nums"
        />
        {units.length > 1 ? (
          <NativeSelect
            aria-label={`Unidade de ${label.toLowerCase()}`}
            name={unitName}
            defaultValue={initialUnit}
            className="w-20 shrink-0"
          >
            {units.map((u) => (
              <option key={u.unit} value={u.unit}>
                {u.unit}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <>
            <input type="hidden" name={unitName} value={units[0]!.unit} />
            <span className="flex w-20 shrink-0 items-center justify-center text-sm text-muted-foreground">
              {units[0]!.unit}
            </span>
          </>
        )}
      </div>
    </Field>
  );
}

/** Número de meses (prazo de envase, conferência). */
function MonthsField({
  id,
  name,
  label,
  hint,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultValue?: number | null;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          defaultValue={defaultValue ?? ''}
          className="min-w-0 flex-1 text-base tabular-nums"
        />
        <span className="shrink-0 text-sm text-muted-foreground">meses</span>
      </div>
    </Field>
  );
}

const CONTENT_LABEL: Record<Measure, string> = {
  UNIT: 'Unidades em cada embalagem (opcional)',
  WEIGHT: 'Peso de cada embalagem',
  VOLUME: 'Volume de cada embalagem',
};

/** No cadastro do produto o conteúdo é só um padrão para a entrada: sempre opcional. */
const PRODUCT_CONTENT_LABEL: Record<Measure, string> = {
  UNIT: 'Unidades em cada embalagem (opcional)',
  WEIGHT: 'Peso de cada embalagem (opcional)',
  VOLUME: 'Volume de cada embalagem (opcional)',
};

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const tops = categories.filter((c) => c.parentId === null);
  return (
    <NativeSelect
      id="product-category"
      name="categoryId"
      required
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Escolha a categoria
      </option>
      {tops.map((t) => {
        const children = categories.filter((c) => c.parentId === t.id);
        return children.length === 0 ? (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ) : (
          <optgroup key={t.id} label={t.name}>
            <option value={t.id}>{t.name} (geral)</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </NativeSelect>
  );
}

function LocationSelect({
  id,
  name,
  locations,
  defaultValue,
}: {
  id: string;
  name: string;
  locations: Option[];
  defaultValue?: string | null;
}) {
  return (
    <NativeSelect id={id} name={name} defaultValue={defaultValue ?? ''}>
      <option value="">Sem local</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export type ProductValues = {
  id: string;
  name: string;
  categoryId: string;
  defaultLocationId: string | null;
  measure: Measure;
  prefix: string;
  minQuantity: number | null;
  targetQuantity: number | null;
  defaultPackage: string | null;
  defaultContent: number | null;
  expiryKind: 'EXPIRY' | 'REPLACE_BY';
  repackShelfLifeMonths: number | null;
  checkEveryMonths: number | null;
  openShelfLifeDays: number | null;
  isMedicine: boolean;
  activeIngredient: string | null;
  strength: string | null;
  medicineForm: MedicineForm | null;
  /** para quem é (D89) */
  people: Option[];
  notes: string | null;
  /** já tem lotes: a forma de contar e o código ficam travados */
  hasLots: boolean;
};

/** Cadastro e edição do produto (D82). */
export function ProductForm({
  categories,
  locations,
  people,
  medicineCategoryIds,
  product,
  defaultCategoryId,
  defaultName,
}: {
  categories: CategoryOption[];
  locations: Option[];
  /** pessoas e bichos da casa, para o "para quem" (D89) */
  people: Option[];
  /** a categoria Remédios e as subcategorias dela: escolher uma marca "É um remédio" (D88) */
  medicineCategoryIds: string[];
  product?: ProductValues;
  defaultCategoryId?: string;
  defaultName?: string;
}) {
  const [state, action, pending] = useActionState(
    product ? updateStockProductAction : createStockProductAction,
    null,
  );
  const [measure, setMeasure] = useState<Measure>(product?.measure ?? 'UNIT');
  const locked = product?.hasLots ?? false;
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? defaultCategoryId ?? '');
  const [isMedicine, setIsMedicine] = useState(
    product?.isMedicine ?? medicineCategoryIds.includes(defaultCategoryId ?? ''),
  );
  const linked = new Set(product?.people.map((p) => p.id));
  return (
    <form action={action} className="space-y-4">
      {product && <input type="hidden" name="id" value={product.id} />}
      <PackageSuggestions />
      <Field label="Nome" htmlFor="product-name">
        <Input
          id="product-name"
          name="name"
          required
          maxLength={80}
          defaultValue={product?.name ?? defaultName}
          placeholder="Ex.: Arroz branco"
        />
      </Field>
      <Field label="Categoria" htmlFor="product-category">
        <CategorySelect
          categories={categories}
          value={categoryId}
          onChange={(id) => {
            setCategoryId(id);
            if (medicineCategoryIds.includes(id)) setIsMedicine(true);
          }}
        />
      </Field>
      <Field
        label="Como contar"
        htmlFor="product-measure"
        hint={
          locked
            ? 'O produto já tem entradas: não muda mais.'
            : 'Peso para grãos, volume para água e líquidos, unidades para o resto.'
        }
      >
        {locked && <input type="hidden" name="measure" value={measure} />}
        <NativeSelect
          id="product-measure"
          name={locked ? undefined : 'measure'}
          value={measure}
          disabled={locked}
          onChange={(e) => setMeasure(e.target.value as Measure)}
        >
          {(Object.keys(MEASURE_LABELS) as Measure[]).map((m) => (
            <option key={m} value={m}>
              {MEASURE_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Local de costume (opcional)" htmlFor="product-location">
        <LocationSelect
          id="product-location"
          name="defaultLocationId"
          locations={locations}
          defaultValue={product?.defaultLocationId}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* a medida decide as unidades: o key recria os campos quando ela muda */}
        <AmountField
          key={`min-${measure}`}
          id="product-min"
          label="Estoque mínimo (opcional)"
          hint="Abaixo disso, aparece como acabando."
          measure={measure}
          name="minText"
          unitName="minUnit"
          value={product?.measure === measure ? product.minQuantity : null}
        />
        <AmountField
          key={`target-${measure}`}
          id="product-target"
          label="Meta (opcional)"
          hint="Quanto quer ter sempre em casa."
          measure={measure}
          name="targetText"
          unitName="targetUnit"
          value={product?.measure === measure ? product.targetQuantity : null}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Embalagem de costume (opcional)"
          htmlFor="product-package"
          hint="Pré-preenche a entrada."
        >
          <Input
            id="product-package"
            name="defaultPackage"
            list="stock-packages"
            maxLength={40}
            defaultValue={product?.defaultPackage ?? ''}
            placeholder="Ex.: pacote"
          />
        </Field>
        <AmountField
          key={`content-${measure}`}
          id="product-content"
          label={PRODUCT_CONTENT_LABEL[measure]}
          measure={measure}
          name="defaultContentText"
          unitName="contentUnit"
          value={product?.measure === measure ? product.defaultContent : null}
        />
      </div>
      <Field
        label="Prazo dos lotes"
        htmlFor="product-expiry-kind"
        hint="Trocar até: para água estocada e o que se troca por tempo, não por validade."
      >
        <NativeSelect
          id="product-expiry-kind"
          name="expiryKind"
          defaultValue={product?.expiryKind ?? 'EXPIRY'}
        >
          <option value="EXPIRY">Validade</option>
          <option value="REPLACE_BY">Trocar até</option>
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <MonthsField
          id="product-repack-months"
          name="repackShelfLifeMonths"
          label="Prazo depois de envasado (opcional)"
          hint="A validade do envase conta da selagem."
          defaultValue={product?.repackShelfLifeMonths}
        />
        <MonthsField
          id="product-check-months"
          name="checkEveryMonths"
          label="Conferir a cada (opcional)"
          hint="Umidade, bicho, vedação."
          defaultValue={product?.checkEveryMonths}
        />
      </div>
      <Field
        label="Validade depois de aberto (opcional)"
        htmlFor="product-open-days"
        hint={'Em dias. Com ela, o "Abri" cria o lote aberto e conta a validade dele.'}
      >
        <div className="flex items-center gap-2">
          <Input
            id="product-open-days"
            name="openShelfLifeDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={3650}
            step={1}
            defaultValue={product?.openShelfLifeDays ?? ''}
            className="min-w-0 flex-1 text-base tabular-nums"
          />
          <span className="shrink-0 text-sm text-muted-foreground">dias</span>
        </div>
      </Field>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Remédio</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isMedicine"
            checked={isMedicine}
            onChange={(e) => setIsMedicine(e.target.checked)}
            className="size-4 accent-primary"
          />
          É um remédio
        </label>
        {isMedicine && (
          <div className="space-y-4">
            <Field
              label="Princípio ativo (opcional)"
              htmlFor="product-ingredient"
              hint="Ex.: dipirona. A busca acha o remédio pelo princípio ativo."
            >
              <Input
                id="product-ingredient"
                name="activeIngredient"
                maxLength={120}
                defaultValue={product?.activeIngredient ?? ''}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dosagem (opcional)" htmlFor="product-strength" hint="Ex.: 500 mg, 200 mg/mL.">
                <Input
                  id="product-strength"
                  name="strength"
                  maxLength={60}
                  defaultValue={product?.strength ?? ''}
                />
              </Field>
              <Field label="Forma" htmlFor="product-form">
                <NativeSelect
                  id="product-form"
                  name="medicineForm"
                  required
                  defaultValue={product?.medicineForm ?? ''}
                >
                  <option value="" disabled>
                    Escolha a forma
                  </option>
                  {MEDICINE_FORMS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </div>
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Para quem (opcional)</legend>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cadastre as pessoas e os bichos da casa em{' '}
            <Link href="/casa/pessoas" className="font-medium text-primary hover:underline">
              Pessoas
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="person"
                  value={p.id}
                  defaultChecked={linked.has(p.id)}
                  className="size-4 accent-primary"
                />
                {p.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Field
        label="Código dos lotes (opcional)"
        htmlFor="product-prefix"
        hint={
          locked
            ? 'Já está nas etiquetas dos lotes: não muda mais.'
            : 'De 2 a 4 letras ou números. Em branco, o app sugere pelo nome (Arroz → ARR).'
        }
      >
        <Input
          id="product-prefix"
          name="prefix"
          maxLength={4}
          readOnly={locked}
          defaultValue={product?.prefix ?? ''}
          className="uppercase"
          autoCapitalize="characters"
          placeholder="ARR"
        />
      </Field>
      <Field label="Observações (opcional)" htmlFor="product-notes">
        <Textarea
          id="product-notes"
          name="notes"
          maxLength={500}
          defaultValue={product?.notes ?? ''}
          rows={2}
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <StickyActions>
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : product ? 'Salvar' : 'Cadastrar'}
        </Button>
      </StickyActions>
    </form>
  );
}

export type LotValues = {
  id: string;
  code: string;
  packageName: string;
  contentPerPackage: number | null;
  locationId: string | null;
  entryDate: string;
  expiryDate: string | null;
  notes: string | null;
};

/** Campos do lote: embalagem, conteúdo, local, datas e observação (entrada e correção). */
function LotFields({
  measure,
  locations,
  today,
  lot,
  defaults,
}: {
  measure: Measure;
  locations: Option[];
  today: string;
  lot?: LotValues;
  defaults?: { packageName: string | null; content: number | null; locationId: string | null };
}) {
  const p = lot?.id ?? 'new';
  return (
    <>
      <PackageSuggestions />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Embalagem" htmlFor={`lot-package-${p}`}>
          <Input
            id={`lot-package-${p}`}
            name="packageName"
            list="stock-packages"
            required
            maxLength={40}
            defaultValue={lot?.packageName ?? defaults?.packageName ?? ''}
            placeholder="Ex.: pacote, garrafa PET, galão"
          />
        </Field>
        <AmountField
          key={`content-${measure}`}
          id={`lot-content-${p}`}
          label={CONTENT_LABEL[measure]}
          measure={measure}
          name="contentText"
          unitName="contentUnit"
          required={measure !== 'UNIT'}
          value={lot ? lot.contentPerPackage : (defaults?.content ?? null)}
        />
      </div>
      <Field label="Local" htmlFor={`lot-location-${p}`}>
        <LocationSelect
          id={`lot-location-${p}`}
          name="locationId"
          locations={locations}
          defaultValue={lot ? lot.locationId : defaults?.locationId}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entrou em" htmlFor={`lot-entry-${p}`}>
          <Input
            id={`lot-entry-${p}`}
            name="entryDate"
            type="date"
            required
            max={today}
            defaultValue={lot?.entryDate ?? today}
          />
        </Field>
        <Field label="Validade (opcional)" htmlFor={`lot-expiry-${p}`}>
          <Input id={`lot-expiry-${p}`} name="expiryDate" type="date" defaultValue={lot?.expiryDate ?? ''} />
        </Field>
      </div>
      <Field label="Observações (opcional)" htmlFor={`lot-notes-${p}`}>
        <Textarea
          id={`lot-notes-${p}`}
          name="notes"
          maxLength={500}
          rows={2}
          defaultValue={lot?.notes ?? ''}
        />
      </Field>
    </>
  );
}

/**
 * Entrada (D83): um lote novo. Com `products`, escolhe o produto (tela "Dar entrada", vai para o produto ao
 * salvar); com `product`, é a entrada daquele produto (painel na tela dele).
 */
export function LotForm({
  products,
  product,
  locations,
  today,
  defaultProductId,
  defaultPackages,
}: {
  products?: ProductOption[];
  product?: ProductOption;
  locations: Option[];
  today: string;
  defaultProductId?: string;
  /** "Comprei" da lista de compras: quantas embalagens vêm preenchidas */
  defaultPackages?: number;
}) {
  const [state, action, pending] = useActionState(addStockLotAction, null);
  useActionDone(state, 'Entrada registrada.');
  const [productId, setProductId] = useState(product?.id ?? defaultProductId ?? '');
  const chosen = product ?? products?.find((p) => p.id === productId);
  const groups = new Map<string, ProductOption[]>();
  for (const p of products ?? []) groups.set(p.categoryLabel, [...(groups.get(p.categoryLabel) ?? []), p]);

  return (
    <form action={action} className="space-y-4">
      {products ? (
        <>
          <input type="hidden" name="voltar" value="produto" />
          <Field label="Produto" htmlFor="lot-product">
            <NativeSelect
              id="lot-product"
              name="productId"
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="" disabled>
                Escolha o produto
              </option>
              {[...groups.entries()]
                .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
                .map(([label, items]) => (
                  <optgroup key={label} label={label}>
                    {items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </NativeSelect>
          </Field>
          <p className="-mt-2 text-sm text-muted-foreground">
            Não está na lista?{' '}
            <Link href="/casa/produtos/novo" className="font-medium text-primary hover:underline">
              Cadastrar produto
            </Link>
          </p>
        </>
      ) : (
        <input type="hidden" name="productId" value={product!.id} />
      )}
      {chosen && (
        <div key={chosen.id} className="space-y-4">
          <Field label="Quantas embalagens" htmlFor="lot-packages">
            <Input
              id="lot-packages"
              name="packages"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              defaultValue={defaultPackages ?? 1}
              className="text-base tabular-nums"
            />
          </Field>
          <LotFields
            measure={chosen.measure}
            locations={locations}
            today={today}
            defaults={{
              packageName: chosen.defaultPackage,
              content: chosen.defaultContent,
              locationId: chosen.defaultLocationId,
            }}
          />
        </div>
      )}
      <FormError message={state && !state.ok ? state.error : null} />
      {products ? (
        <StickyActions>
          <Button type="submit" disabled={pending || !chosen}>
            {pending ? 'Salvando…' : 'Dar entrada'}
          </Button>
        </StickyActions>
      ) : (
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Salvando…' : 'Dar entrada'}
        </Button>
      )}
    </form>
  );
}

/** Corrigir os dados de um lote (a quantidade só muda por movimento). */
export function LotEditForm({
  lot,
  measure,
  locations,
  today,
}: {
  lot: LotValues;
  measure: Measure;
  locations: Option[];
  today: string;
}) {
  const [state, action, pending] = useActionState(updateStockLotAction, null);
  useActionDone(state, `Lote ${lot.code} salvo.`);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={lot.id} />
      <LotFields measure={measure} locations={locations} today={today} lot={lot} />
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}

/** "Usei" / "Descartei": automático tira do que vence primeiro (FEFO); dá para escolher o lote. */
export function UseForm({
  productId,
  kind,
  lots,
  today,
}: {
  productId: string;
  kind: 'USE' | 'DISCARD';
  /** lotes com estoque, na ordem de uso */
  lots: { id: string; label: string }[];
  today: string;
}) {
  const [state, action, pending] = useActionState(useStockAction, null);
  useActionDone(state, kind === 'USE' ? 'Baixa registrada.' : 'Descarte registrado.');
  const p = kind.toLowerCase();
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="kind" value={kind} />
      <Field label="Quantas embalagens" htmlFor={`${p}-packages`}>
        <Input
          id={`${p}-packages`}
          name="packages"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          required
          defaultValue={1}
          className="text-base tabular-nums"
        />
      </Field>
      <Field
        label="De qual lote"
        htmlFor={`${p}-lot`}
        hint="Automático tira do que vence primeiro e passa para o próximo quando um acaba."
      >
        <NativeSelect id={`${p}-lot`} name="lotId" defaultValue="">
          <option value="">Automático (o que vence primeiro)</option>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Quando" htmlFor={`${p}-date`}>
        <Input id={`${p}-date`} name="date" type="date" required max={today} defaultValue={today} />
      </Field>
      <Field label="Observações (opcional)" htmlFor={`${p}-notes`}>
        <Input
          id={`${p}-notes`}
          name="notes"
          maxLength={500}
          placeholder={kind === 'DISCARD' ? 'Ex.: venceu, embalagem furada' : undefined}
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : kind === 'USE' ? 'Dar baixa' : 'Descartar'}
      </Button>
    </form>
  );
}

/** "Contei": o lote passa a ter o que foi contado (ajuste). */
export function CountForm({
  lotId,
  code,
  current,
  today,
}: {
  lotId: string;
  code: string;
  current: number;
  today: string;
}) {
  const [state, action, pending] = useActionState(countStockLotAction, null);
  useActionDone(state, `Contagem do ${code} registrada.`);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="lotId" value={lotId} />
      <Field
        label="Quantas embalagens tem"
        htmlFor={`count-${lotId}`}
        hint={`O app tem ${current}. A diferença entra como ajuste.`}
      >
        <Input
          id={`count-${lotId}`}
          name="counted"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          required
          defaultValue={current}
          className="text-base tabular-nums"
        />
      </Field>
      <Field label="Quando" htmlFor={`count-date-${lotId}`}>
        <Input id={`count-date-${lotId}`} name="date" type="date" required max={today} defaultValue={today} />
      </Field>
      <Field label="Observações (opcional)" htmlFor={`count-notes-${lotId}`}>
        <Input id={`count-notes-${lotId}`} name="notes" maxLength={500} />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar contagem'}
      </Button>
    </form>
  );
}

/**
 * Envasar (D84): quantas embalagens saem de cada lote e o lote novo (garrafas, conteúdo, local, selagem). A
 * validade em branco é calculada pela selagem + o prazo do produto.
 */
export function RepackForm({
  product,
  lots,
  locations,
  today,
}: {
  product: ProductOption & { repackShelfLifeMonths: number | null };
  /** lotes com estoque, na ordem de uso */
  lots: { id: string; code: string; label: string; quantity: number }[];
  locations: Option[];
  today: string;
}) {
  const [state, action, pending] = useActionState(repackStockAction, null);
  const months = product.repackShelfLifeMonths;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="productId" value={product.id} />
      <PackageSuggestions />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Quantas embalagens saem de cada lote</legend>
        {lots.map((l) => (
          <div key={l.id} className="flex items-center gap-3">
            <label htmlFor={`repack-src-${l.id}`} className="min-w-0 flex-1 text-sm">
              <span className="font-mono font-semibold">{l.code}</span>{' '}
              <span className="text-muted-foreground">{l.label}</span>
            </label>
            <Input
              id={`repack-src-${l.id}`}
              name={`source:${l.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={l.quantity}
              step={1}
              defaultValue={0}
              className="w-20 shrink-0 text-base tabular-nums"
            />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantas embalagens saíram do envase" htmlFor="repack-packages">
          <Input
            id="repack-packages"
            name="packages"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            className="text-base tabular-nums"
          />
        </Field>
        <Field label="Embalagem nova" htmlFor="repack-package">
          <Input
            id="repack-package"
            name="packageName"
            list="stock-packages"
            required
            maxLength={40}
            defaultValue="garrafa PET"
          />
        </Field>
      </div>
      <AmountField
        id="repack-content"
        label={CONTENT_LABEL[product.measure]}
        measure={product.measure}
        name="contentText"
        unitName="contentUnit"
        required={product.measure !== 'UNIT'}
      />
      <Field label="Local" htmlFor="repack-location">
        <LocationSelect
          id="repack-location"
          name="locationId"
          locations={locations}
          defaultValue={product.defaultLocationId}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Selado em" htmlFor="repack-seal">
          <Input id="repack-seal" name="sealDate" type="date" required max={today} defaultValue={today} />
        </Field>
        <Field
          label="Validade (opcional)"
          htmlFor="repack-expiry"
          hint={
            months
              ? `Em branco: selagem + ${months} ${months === 1 ? 'mês' : 'meses'}.`
              : 'Sem prazo de envase no produto: informe aqui.'
          }
        >
          <Input id="repack-expiry" name="expiryDate" type="date" />
        </Field>
      </div>
      <Field label="Observações (opcional)" htmlFor="repack-notes">
        <Input id="repack-notes" name="notes" maxLength={500} placeholder="Ex.: com absorvedor de oxigênio" />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Envasar'}
      </Button>
    </form>
  );
}

/** "Conferi" (D85): a data e o que viu; a próxima conferência conta a partir daqui. */
export function CheckForm({ lotId, code, today }: { lotId: string; code: string; today: string }) {
  const [state, action, pending] = useActionState(checkStockLotAction, null);
  useActionDone(state, `Conferência do ${code} registrada.`);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="lotId" value={lotId} />
      <Field label="Quando" htmlFor={`check-date-${lotId}`}>
        <Input id={`check-date-${lotId}`} name="date" type="date" required max={today} defaultValue={today} />
      </Field>
      <Field label="O que viu (opcional)" htmlFor={`check-notes-${lotId}`}>
        <Input
          id={`check-notes-${lotId}`}
          name="notes"
          maxLength={500}
          placeholder="Ex.: tudo ok, umidade na garrafa 3"
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Conferi'}
      </Button>
    </form>
  );
}
