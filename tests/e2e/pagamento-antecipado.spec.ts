/**
 * Pagamento antecipado (D70), 375px: conta que vence no mês que vem e é paga hoje com desconto. O dinheiro sai do
 * saldo hoje, o pagamento aparece neste mês ligado à conta original (que fica "paga antes", fora das somas do mês
 * dela), o detalhe mostra o desconto e estornar devolve a conta para "a pagar".
 * Roda depois de fase2/3/4 e loans (ordem alfabética): mexe no saldo da conta.
 */
import { expect, test, type Page } from '@playwright/test';
import { addMonths, monthStart, toMonthParam, today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { login } from './login';
import { pickCategory } from './forms';

test.describe.configure({ mode: 'serial' });

let page: Page;

const nextMonth = addMonths(monthStart(today()), 1); // vencimento: dia 1 do mês que vem
const nextParam = toMonthParam(nextMonth);
const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
const cents = (text: string) => {
  const m = /(-?)R\$\s([\d.]+),(\d{2})/.exec(text.replace(/ /g, ' '));
  if (!m) throw new Error(`sem valor em: ${text}`);
  return (m[1] ? -1 : 1) * Number(m[2]!.replace(/\./g, '') + m[3]);
};
const balance = async () => {
  await page.goto('/');
  return cents(await page.locator('[data-slot=card]').filter({ hasText: 'Saldo atual' }).first().innerText());
};
const nextMonthPayable = async () => {
  await page.goto(`/?mes=${nextParam}`);
  return cents(await page.getByTestId('kpi-a-pagar').innerText());
};

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('paga hoje, com desconto, uma conta que vence no mês que vem', async () => {
  // saldo de sobra para a conta não pedir aporte
  await page.goto('/lancamentos/novo');
  await page.getByRole('radio', { name: 'Receita' }).click();
  await page.getByLabel('Valor').fill('100000');
  await page.getByLabel('Descrição').fill('Receita para antecipar');
  await pickCategory(page, 'Salário CLT');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/lancamentos/);

  const payableBefore = await nextMonthPayable();
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill('21780');
  await page.getByLabel('Descrição').fill('Parcela antecipada');
  await pickCategory(page, 'Contas da casa');
  await page.locator('#date').fill(nextMonth);
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/lancamentos/);
  expect(await nextMonthPayable()).toBe(payableBefore + 21_780); // a pagar no mês que vem

  const balanceBefore = await balance();
  await page.goto(`/lancamentos?mes=${nextParam}`);
  await page.getByRole('link', { name: /Parcela antecipada/ }).click();
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor pago').fill('21593'); // R$ 215,93: R$ 1,87 de desconto
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeHidden();

  expect(await balance()).toBe(balanceBefore - 21_593); // saiu do saldo hoje, pelo valor pago
  expect(await nextMonthPayable()).toBe(payableBefore); // e não conta mais em "A pagar" do mês que vem
});

test('o pagamento fica neste mês, com o desconto, ligado à conta original', async () => {
  await page.goto('/lancamentos');
  const row = page.getByRole('link', { name: /Parcela antecipada/ });
  await expect(row).toContainText('Antecipado');
  await expect(row).toContainText('215,93');
  await row.click();

  await expect(page.getByText('Pago antecipado').first()).toBeVisible();
  await expect(page.getByTestId('entry-discount')).toContainText('1,87');
  await expect(page.getByText('Previsto')).toBeVisible();
  await noHorizontalScroll();

  await page.getByTestId('anticipation-link').click(); // → conta original
  await expect(page.getByText('Pago antes').first()).toBeVisible();
  await expect(page.getByText(/não entra nas somas de/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar pagamento' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
  await noHorizontalScroll();

  await page.getByTestId('anticipation-link').click(); // ← de volta ao pagamento
  await expect(page.getByTestId('entry-discount')).toBeVisible();
});

test('no mês do vencimento a conta original aparece marcada, sem somar', async () => {
  await page.goto(`/lancamentos?mes=${nextParam}`);
  const row = page.getByRole('link', { name: /Parcela antecipada/ });
  await expect(row).toContainText('Pago antes');
  await expect(row).toContainText('fora das somas');
  await noHorizontalScroll();
});

test('estornar o pagamento devolve a conta para "a pagar" e o dinheiro ao saldo', async () => {
  const payableAfterPay = await nextMonthPayable();
  const balanceAfterPay = await balance();

  await page.goto('/lancamentos');
  await page.getByRole('link', { name: /Parcela antecipada/ }).click();
  await page.getByRole('button', { name: 'Estornar pagamento' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Estornar' }).click();
  await expect(page.getByText('Pendente').first())
    .toBeVisible({ timeout: 15_000 })
    .catch(() => undefined);

  expect(await balance()).toBe(balanceAfterPay + 21_593);
  expect(await nextMonthPayable()).toBe(payableAfterPay + 21_780);
  await page.goto(`/lancamentos?mes=${nextParam}`);
  await expect(page.getByRole('link', { name: /Parcela antecipada/ })).toContainText('Pendente');
});
