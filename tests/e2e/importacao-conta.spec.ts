/**
 * Importação do extrato da conta por OFX no navegador (375px), com a fixture anonimizada da conta Nubank.
 * As datas são deslocadas para o mês atual (o banco do E2E começa no dia 1º do mês corrente).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addMonths, diffMonths, today } from '../../src/domain/dates';
import { e2eEnv } from './env';

function shiftedFixture(): Buffer {
  const shift = Math.max(0, diffMonths(today(), '2026-10-18'));
  const text = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account.ofx'), 'utf8').replace(
    /<(DTPOSTED|DTSTART|DTEND|DTASOF)>(\d{4})(\d{2})(\d{2})/g,
    (_, tag: string, y: string, m: string, d: string) =>
      `<${tag}>${addMonths(`${y}-${m}-${d}`, shift).replace(/-/g, '')}`,
  );
  return Buffer.from(text, 'utf8');
}

test('importar o extrato da conta: criar em lote, pagamento de fatura e transferências', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEnv.users.eduardo.email);
  await page.getByLabel('Senha').fill(e2eEnv.users.eduardo.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible();

  // D44: o saldo inicial pode ser corrigido em Ajustes
  await page.goto('/ajustes');
  await page.getByRole('button', { name: 'Salvar saldo inicial' }).click();
  await expect(page.getByText('Saldo inicial atualizado.')).toBeVisible();

  await page.goto('/lancamentos');
  await page.getByRole('link', { name: 'Importar extrato (OFX)' }).click();
  await page.getByLabel('Arquivo OFX do extrato').setInputFiles({
    name: 'NU_conta.ofx',
    mimeType: 'application/x-ofx',
    buffer: shiftedFixture(),
  });
  await page.getByRole('button', { name: 'Importar e revisar' }).click();
  await expect(page).toHaveURL(/\/importacoes\//);
  await expect(page.getByText('Extrato da conta', { exact: true })).toBeVisible();
  await expect(page.getByText(/no app:.*no arquivo:/)).toBeVisible();

  // lote: tudo menos o pagamento de fatura sem par (pede a fatura) e linhas com sugestão
  const createAll = page.getByRole('button', { name: /Criar as \d+ novas/ });
  if (await createAll.isVisible()) {
    await createAll.click();
  }
  const payment = page
    .locator('[data-testid=account-line]')
    .filter({ has: page.locator('div.truncate', { hasText: /^Pagamento de fatura$/ }) });
  if (await payment.getByRole('button', { name: 'Não é esse' }).isVisible()) {
    await payment.getByRole('button', { name: 'Não é esse' }).click();
  }
  await expect(payment.getByLabel('Tipo')).toHaveValue('INVOICE_PAYMENT');
  const invoiceSelect = payment.getByLabel('Pagou qual fatura?');
  const firstInvoice = await invoiceSelect.locator('option:not([disabled])').first().getAttribute('value');
  await invoiceSelect.selectOption(firstInvoice!);
  await payment.getByRole('button', { name: 'Criar lançamento' }).click();
  await expect(payment).toHaveCount(0);

  // as restantes (com sugestão do que já existia) são ignoradas para fechar o lote
  const rest = page.locator('[data-testid=account-line]');
  while ((await rest.count()) > 0) {
    await rest.first().getByRole('button', { name: 'Ignorar linha' }).click();
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByText('0 a revisar')).toBeVisible();
  await expect(page.getByText('Aplicação RDB').first()).toBeVisible();

  // D45: transferência não aparece como despesa nos lançamentos
  await page.goto('/lancamentos?tipo=EXPENSE');
  await expect(page.getByText('MERCEARIA EXEMPLO')).toBeVisible();
  await expect(page.getByText('Aplicação RDB')).toHaveCount(0);

  // mesmo arquivo de novo: bloqueado
  await page.goto('/lancamentos/importar');
  await page.getByLabel('Arquivo OFX do extrato').setInputFiles({
    name: 'NU_conta.ofx',
    mimeType: 'application/x-ofx',
    buffer: shiftedFixture(),
  });
  await page.getByRole('button', { name: 'Importar e revisar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'já foi importado' })).toBeVisible();
});
