'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  addStockLotAction,
  countStockLotAction,
  createStockProductAction,
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
  defaultValue,
}: {
  categories: CategoryOption[];
  defaultValue?: string;
}) {
  const tops = categories.filter((c) => c.parentId === null);
  return (
    <NativeSelect id="product-category" name="categoryId" required defaultValue={defaultValue ?? ''}>
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
  notes: string | null;
  /** já tem lotes: a forma de contar e o código ficam travados */
  hasLots: boolean;
};

/** Cadastro e edição do produto (D82). */
export function ProductForm({
  categories,
  locations,
  product,
  defaultCategoryId,
  defaultName,
}: {
  categories: CategoryOption[];
  locations: Option[];
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
        <CategorySelect categories={categories} defaultValue={product?.categoryId ?? defaultCategoryId} />
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
}: {
  products?: ProductOption[];
  product?: ProductOption;
  locations: Option[];
  today: string;
  defaultProductId?: string;
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
              defaultValue={1}
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
