/**
 * Importação da fatura por OFX no navegador (375px), com a fixture anonimizada do Nubank.
 * As datas da fixture são deslocadas para o mês atual, para o teste valer em qualquer data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addMonths, diffMonths, today } from '../../src/domain/dates';
import { e2eEnv } from './env';

function shiftedFixture(): Buffer {
  const shift = Math.max(0, diffMonths(today(), '2026-10-18'));
  const text = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-card.ofx'), 'latin1').replace(
    /<(DTPOSTED|DTSTART|DTEND|DTASOF)>(\d{4})(\d{2})(\d{2})/g,
    (_, tag: string, y: string, m: string, d: string) => {
      const iso = addMonths(`${y}-${m}-${d}`, shift);
      return `<${tag}>${iso.replace(/-/g, '')}`;
    },
  );
  return Buffer.from(text, 'latin1');
}

test('importar a fatura: criar em lote, confirmar o total da parcela 1/2 e bater com o arquivo', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEnv.users.eduardo.email);
  await page.getByLabel('Senha').fill(e2eEnv.users.eduardo.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible();

  await page.goto('/cartoes/novo');
  await page.getByLabel('Nome').fill('Nubank Import');
  await page.getByLabel('Dia do vencimento').fill('16');
  await expect(page.getByLabel('Dia do fechamento')).toHaveValue('9');
  await page.getByLabel('Limite').fill('4.300,00');
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();
  await expect(page.getByText('Nubank Import').first()).toBeVisible();

  await page.getByRole('link', { name: 'Importar fatura (OFX)' }).click();
  await page.getByLabel('Arquivo OFX da fatura').setInputFiles({
    name: 'Nubank_fatura.ofx',
    mimeType: 'application/x-ofx',
    buffer: shiftedFixture(),
  });
  await page.getByRole('button', { name: 'Importar e revisar' }).click();
  await expect(page).toHaveURL(/\/importacoes\//);
  await expect(page.getByText('10 a revisar')).toBeVisible();

  await page.getByRole('button', { name: /Criar as \d+ novas/ }).click();
  await expect(
    page.getByText(/Faltam revisar uma a uma: Farmacia Exemplo \(confirme o total da compra\)/),
  ).toBeVisible();

  const farmacia = page.locator('[data-slot=card]').filter({ hasText: 'Farmacia Exemplo - Parcela 1/2' });
  await expect(farmacia.getByLabel('Valor total da compra')).toHaveValue('174,76');
  await farmacia.getByLabel('Valor total da compra').fill('174,75');
  await farmacia.getByRole('button', { name: 'Criar lançamento' }).click();

  await expect(page.getByText('bate centavo a centavo')).toBeVisible();
  await expect(page.getByText(/A pagar no app: R\$\s818,61/)).toBeVisible();

  // reimportar o mesmo arquivo é bloqueado
  await page.getByRole('link', { name: 'Importações' }).click();
  await page.getByLabel('Arquivo OFX da fatura').setInputFiles({
    name: 'Nubank_fatura.ofx',
    mimeType: 'application/x-ofx',
    buffer: shiftedFixture(),
  });
  await page.getByRole('button', { name: 'Importar e revisar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'já foi importado' })).toBeVisible();
});
