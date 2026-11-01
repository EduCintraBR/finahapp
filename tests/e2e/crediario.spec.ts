/**
 * Crediário no navegador (375px, D73): cadastro com prazo da 1ª fatura, compra parcelada com valor da compra e
 * total com juros (prévia do acréscimo), detalhe com os juros e limite descontando o total.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { pickCategory } from './forms';
import { login } from './login';

test.describe.configure({ mode: 'serial' });

let page: Page;
let storeUrl = '';

const brl = (v: string) => new RegExp(`R\\$\\s${v.replace(/\./g, '\\.')}`);
const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('cadastrar crediário: prazo da 1ª fatura e fechamento antes do vencimento', async () => {
  await page.goto('/cartoes');
  await page.getByRole('region', { name: 'Crediários' }).getByRole('link', { name: 'Crediário' }).click();
  await expect(page.getByRole('heading', { name: 'Novo crediário' })).toBeVisible();
  await expect(page.getByLabel('Prazo da 1ª fatura')).toHaveValue('40');
  await expect(page.getByLabel('Fecha antes do vencimento')).toHaveValue('7');
  await expect(page.getByLabel('Dia do fechamento')).toHaveCount(0);
  await page.getByLabel('Nome').fill('Shopee Parcelado');
  await page.getByLabel('Limite').fill('65000'); // máscara de centavos primeiro
  await expect(page.getByLabel('Limite')).toHaveValue('650,00');
  await noHorizontalScroll();
  await page.getByRole('button', { name: 'Cadastrar crediário' }).click();

  await expect(page).toHaveURL(/\/cartoes\/[0-9a-f-]{36}$/);
  storeUrl = page.url();
  await expect(page.getByText(/1ª fatura vence 40 dias após a compra · fecha 7 dias antes/)).toBeVisible();
  await expect(page.getByText(/^Disponível/).first()).toContainText(brl('650,00'));
  await expect(page.getByRole('link', { name: 'Importar fatura (OFX)' })).toHaveCount(0);
  await noHorizontalScroll();
});

test('compra parcelada com juros: valor da compra, total a pagar e prévia do acréscimo', async () => {
  await page.goto(storeUrl);
  await page.getByRole('link', { name: 'Nova compra' }).click();
  await expect(page).toHaveURL(/tipo=cartao&cartao=/);
  await page.getByLabel('Valor da compra').fill('10000');
  await expect(page.getByLabel('Valor da compra')).toHaveValue('100,00');
  await page.getByLabel('Parcelas').fill('3');
  await page.getByLabel('Total a pagar').fill('11500');
  await expect(page.getByText(/1ª de R\$\s38,34 \+ 2× de R\$\s38,33/)).toBeVisible();
  await expect(page.getByText(/Acréscimo de R\$\s15,00 \(15,00% · ~\d+,\d{2}% ao mês\)/)).toBeVisible();
  await page.getByLabel('Descrição').fill('Fone');
  await pickCategory(page, 'Compras');
  await noHorizontalScroll();
  await page.getByRole('button', { name: 'Lançar' }).click();

  await expect(page).toHaveURL(/\/cartoes\/faturas\//);
  await page.getByRole('link', { name: /Fone/ }).first().click();
  await expect(page).toHaveURL(/\/cartoes\/compras\//);
  const interest = page.getByTestId('purchase-interest');
  await expect(interest).toContainText(brl('100,00'));
  await expect(interest).toContainText('15,00%');
  await expect(interest).toContainText(/ao mês/);
  await noHorizontalScroll();
});

test('o limite desconta o total com juros e a página mostra os juros das compras', async () => {
  await page.goto(storeUrl);
  await expect(page.getByText(/^Disponível/).first()).toContainText(brl('535,00'));
  await expect(page.getByText(/Juros nas compras/)).toContainText(brl('15,00'));
  await page.goto('/cartoes');
  await expect(
    page.getByRole('region', { name: 'Crediários' }).getByRole('link', { name: /Shopee Parcelado/ }),
  ).toBeVisible();
});

test('sem total, a compra no crediário fica sem juros', async () => {
  await page.goto(storeUrl);
  await page.getByRole('link', { name: 'Nova compra' }).click();
  await page.getByLabel('Valor da compra').fill('2000');
  await page.getByLabel('Descrição').fill('Capinha');
  await pickCategory(page, 'Compras');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/cartoes\/faturas\//);
  await page.goto(storeUrl);
  await expect(page.getByText(/^Disponível/).first()).toContainText(brl('515,00'));
});
