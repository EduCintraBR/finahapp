/**
 * Situação do pagamento e aporte (D69), 375px: despesa nasce "a pagar" (vencida se a data passou) e só sai do saldo
 * na baixa; sem saldo, a baixa pede o aporte com observação; a conta pode ser paga com a carteira do cartão de
 * benefícios; e uma despesa que nasceu paga pode voltar a "a pagar".
 * Roda depois de fase2/3/4 e loans (ordem alfabética): mexe no saldo da conta.
 */
import { expect, test, type Page } from '@playwright/test';
import { monthStart, today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { homePending, openPayment } from './home';
import { login } from './login';
import { moreAction, pickCategory } from './forms';

test.describe.configure({ mode: 'serial' });

let page: Page;

const brl = (v: string) => new RegExp(`R\\$\\s${v.replace(/\./g, '\\.')}`);
const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
/** "R$ 1.234,56" → centavos (o primeiro valor do texto). */
const cents = (text: string) => {
  const m = /(-?)R\$\s([\d.]+),(\d{2})/.exec(text.replace(/ /g, ' '));
  if (!m) throw new Error(`sem valor em: ${text}`);
  return (m[1] ? -1 : 1) * Number(m[2]!.replace(/\./g, '') + m[3]);
};
const homeCard = (label: string) => page.locator('[data-slot=card]').filter({ hasText: label }).first();
const balance = async () => {
  await page.goto('/');
  // o card traz "Saldo atual · Conta principal R$ x": o primeiro valor é o saldo
  return cents(await homeCard('Saldo atual').innerText());
};
const kpiAmount = async (slug: string) => cents(await page.getByTestId(`kpi-${slug}`).innerText());

async function newExpense(description: string, amountCents: number, opts: { paid: boolean; date?: string }) {
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill(String(amountCents));
  await page.getByLabel('Descrição').fill(description);
  await pickCategory(page, 'Contas da casa');
  if (opts.date) await page.locator('#date').fill(opts.date);
  if (opts.paid) await page.getByLabel('Já paguei').check();
  await page.getByRole('button', { name: 'Lançar' }).click();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('despesa lançada sem "Já paguei" fica a pagar (vencida se a data passou) e não sai do saldo', async () => {
  const before = await balance();
  const opening = monthStart(today()); // primeiro dia do controle: a data mais antiga permitida
  await newExpense('Cemig vencida', 31_000, { paid: false, date: opening });
  await expect(page).toHaveURL(/\/lancamentos/);
  const row = page.getByRole('link', { name: /Cemig vencida/ });
  await expect(row).toContainText('Pendente');
  if (opening !== today()) await expect(row).toContainText('Venceu');
  expect(await balance()).toBe(before); // continua tudo na conta

  // aparece em "Pendentes" na Home, pronta para a baixa
  await expect(page.getByRole('listitem').filter({ hasText: 'Cemig vencida' })).toBeVisible();
  await noHorizontalScroll();
});

test('o formulário explica a chave: desligada vira vencimento, ligada sai do saldo', async () => {
  await page.goto('/lancamentos/novo');
  await expect(page.getByLabel('Vencimento', { exact: true })).toBeVisible();
  await expect(page.getByText(/Fica a pagar no dia do vencimento/)).toBeVisible();
  await page.getByLabel('Já paguei').check();
  await expect(page.getByText('Sai do saldo da conta agora')).toBeVisible();
  await expect(page.getByLabel('Data', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Receita' }).click();
  await expect(page.getByLabel('Já paguei')).toHaveCount(0); // receita é sempre recebida
});

test('despesa que nasceu paga pode voltar a "a pagar"', async () => {
  await newExpense('Paga sem querer', 1_000, { paid: true, date: today() });
  await expect(page).toHaveURL(/\/lancamentos/);
  const row = page.getByRole('link', { name: /Paga sem querer/ });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('Pendente'); // pago é o caso normal: sem selo
  await row.click();
  await moreAction(page, 'Marcar como a pagar');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Marcar como a pagar' }).click();
  await expect(page.getByText('Pendente').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar como a pagar' })).toHaveCount(0);
});

test('dar baixa sem saldo pede o aporte, com observação; o aporte entra no saldo e fica fora de "Entrou"', async () => {
  const bal = await balance();
  const entrouBefore = await (async () => {
    await page.goto('/');
    return kpiAmount('entrou');
  })();
  const amount = bal + 12_345; // sempre R$ 123,45 a mais do que a conta tem
  await newExpense('Conta grande', amount, { paid: false, date: today() });
  await page.goto('/');
  const item = await homePending(page, 'Conta grande');
  const dialog = await openPayment(page, item);
  await dialog.getByRole('button', { name: 'Confirmar' }).click();

  // o servidor diz quanto falta e o formulário mostra os campos do aporte, sem perder o que foi digitado
  const fields = dialog.getByTestId('funding-fields');
  await expect(fields).toContainText('faltam R$ 123,45');
  await expect(fields.getByLabel('Valor do aporte')).toHaveValue('123,45');
  await expect(dialog.getByLabel('Valor pago')).toHaveValue(
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(amount / 100),
  );
  // sem observação não passa
  await fields.getByLabel('De onde veio').fill('ab');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(fields).toBeVisible(); // o navegador barra a observação curta; o servidor também (testes de aceitação)
  await fields.getByLabel('De onde veio').fill('Cobri com a poupança');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeHidden();

  expect(await balance()).toBe(0); // saldo + aporte − conta
  expect(await kpiAmount('entrou')).toBe(entrouBefore); // o aporte não é receita
  await page.goto('/lancamentos');
  const aporte = page.getByRole('link', { name: /Aporte · Conta grande/ });
  await expect(aporte).toBeVisible();
  await aporte.click();
  await expect(page.getByText('Cobri com a poupança')).toBeVisible(); // a observação fica registrada
  await noHorizontalScroll();
});

test('pagar a conta com a carteira do cartão de benefícios: sai da carteira, não da conta', async () => {
  // cartão novo com uma carteira de R$ 300,00
  await page.goto('/beneficios/novo');
  await page.getByLabel('Nome do cartão').fill('Cartão Contas');
  await page.locator('#w0name').fill('Contas da casa');
  await page.locator('#w0credit').fill('30000');
  await page.locator('#w0opening').fill('30000');
  await page.getByRole('button', { name: 'Remover carteira' }).click();
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();
  await expect(page).toHaveURL(/\/beneficios\/[0-9a-f-]{36}/);
  const cardUrl = page.url();

  await newExpense('Internet pelo benefício', 10_000, { paid: false, date: today() });
  const accountBefore = await balance();
  const item = await homePending(page, 'Internet pelo benefício');
  const dialog = await openPayment(page, item);
  const walletOption = await dialog
    .getByLabel('Pagar com')
    .locator('option', { hasText: 'Cartão Contas · Contas da casa' })
    .getAttribute('value');
  await dialog.getByLabel('Pagar com').selectOption(walletOption!);
  await expect(dialog.getByText('O valor sai da carteira do cartão de benefícios')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeHidden();

  expect(await balance()).toBe(accountBefore); // a conta não mexeu
  await page.goto(cardUrl);
  await expect(page.getByTestId('saldo-Contas da casa')).toContainText(brl('200,00'));
  await expect(page.getByText('Internet pelo benefício')).toBeVisible();
  await noHorizontalScroll();
});
