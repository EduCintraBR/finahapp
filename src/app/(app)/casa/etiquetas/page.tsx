import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { Field, NativeSelect } from '@/components/forms/fields';
import { PageHeader } from '@/components/layout/page-header';
import { PrintButton } from '@/components/stock/print-button';
import { expiryWord } from '@/components/stock/stock-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getDb } from '@/db/client';
import { lotDetail, type LotDetail } from '@/db/queries/stock';
import { formatDateBR, today } from '@/domain/dates';
import { formatAmount } from '@/domain/stock/measure';

export const metadata: Metadata = { title: 'Etiquetas' };

/** Etiquetas por folha A4: 2 × 2, cada uma com 1/4 da folha (105 × 148,5 mm, D87). */
const PER_SHEET = 4;
const MAX_LABELS = 200;

/** Endereço do app para o QR: o configurado (AUTH_URL) ou o da própria requisição. */
async function appOrigin(): Promise<string> {
  const configured = process.env.AUTH_URL?.replace(/\/+$/, '');
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const intParam = (v: string | string[] | undefined, min: number, max: number, fallback: number) => {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Uma etiqueta: o tamanho de tudo é relativo à largura da etiqueta (unidades cqw), então o mesmo desenho serve
 * para a prévia na tela e para os 105 mm do papel. Sempre preto no branco, também no tema escuro.
 */
function Label({ detail, qr }: { detail: LotDetail; qr: string }) {
  const { lot, product } = detail;
  const repack = lot.origin === 'REPACK';
  const content = lot.contentPerPackage ? formatAmount(product.measure, lot.contentPerPackage) : null;
  return (
    // o container não tem padding: cqw mede a caixa de conteúdo dele, que assim é a etiqueta inteira
    <div className="@container size-full bg-white text-black" data-testid="stock-label">
      <div className="flex size-full flex-col p-[6cqw]">
        <p className="truncate text-[7cqw] leading-tight font-semibold">{product.name}</p>
        <p className="text-[4.5cqw] leading-tight text-neutral-600">
          {lot.packageName}
          {content && ` · ${content}`}
        </p>
        <p className="mt-[3cqw] font-mono text-[23cqw] leading-none font-bold tracking-tight">{lot.code}</p>
        <dl className="mt-[6cqw] space-y-[2cqw] text-[6cqw] leading-tight">
          <div className="flex gap-[2cqw]">
            <dt className="text-neutral-600">{repack ? 'Selado em' : 'Entrou em'}</dt>
            <dd className="font-semibold">{formatDateBR(lot.entryDate)}</dd>
          </div>
          {lot.expiryDate && (
            <div className="flex gap-[2cqw]">
              <dt className="text-neutral-600">{expiryWord(product.expiryKind, 'ok')}</dt>
              <dd className="text-[10cqw] leading-none font-bold">{formatDateBR(lot.expiryDate)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-auto flex items-end justify-between gap-[3cqw]">
          {product.checkEveryMonths ? (
            <div className="min-w-0 flex-1 text-[3.8cqw] leading-tight">
              <p className="font-semibold">
                Conferir a cada {product.checkEveryMonths} {product.checkEveryMonths === 1 ? 'mês' : 'meses'}
              </p>
              {[0, 1, 2].map((i) => (
                <p key={i} className="mt-[2.5cqw] border-b border-neutral-400 pb-[0.5cqw] text-neutral-500">
                  ___/___/______
                </p>
              ))}
            </div>
          ) : (
            <p className="min-w-0 flex-1 text-[3.5cqw] leading-tight text-neutral-500">
              Aponte a câmera para abrir o lote no Finah.
            </p>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- QR gerado no servidor (data URL) */}
          <img src={qr} alt={`QR do lote ${lot.code}`} className="aspect-square w-[34cqw] shrink-0" />
        </div>
      </div>
    </div>
  );
}

/**
 * Etiquetas para imprimir (D87): uma por embalagem do lote, 4 por folha A4 (1/4 de folha cada, com marcas de
 * corte). "Começar na posição" aproveita uma folha já usada. A impressão é a do navegador (no celular, dá para
 * salvar em PDF).
 */
export default async function LabelsPage({ searchParams }: PageProps<'/casa/etiquetas'>) {
  const { lote, n, inicio } = await searchParams;
  if (typeof lote !== 'string') notFound();
  const detail = await lotDetail(getDb(), lote, today()).catch(() => null);
  if (!detail) notFound();
  const { lot } = detail;
  const count = intParam(n, 1, MAX_LABELS, Math.min(Math.max(lot.quantity, 1), MAX_LABELS));
  const start = intParam(inicio, 1, PER_SHEET, 1);
  const qr = await QRCode.toDataURL(`${await appOrigin()}/casa/lotes/${lot.id}`, {
    margin: 0,
    width: 360,
    errorCorrectionLevel: 'M',
  });

  // posições da folha: as já usadas (antes de "começar na posição") ficam vazias
  const cells: (number | null)[] = [
    ...Array<null>(start - 1).fill(null),
    ...Array.from({ length: count }, (_, i) => i),
  ];
  const sheets: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += PER_SHEET) sheets.push(cells.slice(i, i + PER_SHEET));
  const last = sheets[sheets.length - 1]!;
  while (last.length < PER_SHEET) last.push(null);

  return (
    <div className="mx-auto max-w-2xl space-y-4 print:m-0 print:max-w-none print:space-y-0">
      {/* A4 retrato sem margem: as etiquetas ocupam a folha inteira, em quartos */}
      <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
      <div className="space-y-4 print:hidden">
        <PageHeader
          title="Etiquetas"
          description={`${lot.code} · ${detail.product.name}`}
          back={{ href: `/casa/lotes/${lot.id}`, label: lot.code }}
        />
        <Card>
          <CardContent>
            <form className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="lote" value={lot.id} />
              <Field label="Quantas etiquetas" htmlFor="labels-count">
                <Input
                  id="labels-count"
                  name="n"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_LABELS}
                  defaultValue={count}
                  className="text-base tabular-nums"
                />
              </Field>
              <Field label="Começar na posição" htmlFor="labels-start">
                <NativeSelect id="labels-start" name="inicio" defaultValue={String(start)}>
                  <option value="1">1 (folha nova)</option>
                  <option value="2">2 (pular 1)</option>
                  <option value="3">3 (pular 2)</option>
                  <option value="4">4 (pular 3)</option>
                </NativeSelect>
              </Field>
              <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1">
                Atualizar
              </Button>
            </form>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {count} {count === 1 ? 'etiqueta' : 'etiquetas'} em {sheets.length}{' '}
            {sheets.length === 1 ? 'folha' : 'folhas'} A4, cada uma com 1/4 da folha. Imprima em tamanho real
            (100%), sem margens.
          </p>
          <PrintButton />
        </div>
      </div>

      {sheets.map((sheet, s) => (
        <section
          key={s}
          aria-label={`Folha ${s + 1}`}
          className="relative grid grid-cols-2 gap-2 print:h-[297mm] print:w-[210mm] print:break-after-page print:grid-rows-2 print:gap-0"
        >
          {sheet.map((cell, i) => (
            <div
              key={i}
              className="aspect-[105/148.5] overflow-hidden rounded-md border border-dashed border-neutral-400 print:aspect-auto print:h-[148.5mm] print:w-[105mm] print:rounded-none print:border-0"
            >
              {cell === null ? (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground print:hidden">
                  Posição já usada
                </div>
              ) : (
                <Label detail={detail} qr={qr} />
              )}
            </div>
          ))}
          {/* marcas de corte: as linhas que dividem a folha em quartos (só no papel) */}
          <div
            aria-hidden
            className="absolute inset-y-0 left-[105mm] hidden border-l border-dashed border-neutral-400 print:block"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 top-[148.5mm] hidden border-t border-dashed border-neutral-400 print:block"
          />
        </section>
      ))}
    </div>
  );
}
