/**
 * Orçamentos no navegador (375px, D79): cadastrar o limite de uma categoria e o teto do mês, ver o alerta "perto do
 * limite" e depois "passou" conforme os gastos entram (Gasto Mensal: a despesa a pagar conta pelo vencimento), o
 * painel da Início, o histórico e parar de acompanhar. As contas exatas ficam nos testes de aceitação.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';
import { pickCategory } from './forms';

test.describe.configure({ mode: 'serial' });

let page: Page;
const CATEGORY = 'Presentes'; // nenhum outro teste usa: o gasto dela é só o deste arquivo

const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
const brl = (v: string) => new RegExp(`R\\$\\s${v.replace(/\./g, '\\.')}`);

/** Abre um painel (SheetAction); repete o toque até a página hidratar. */
async function openSheet(button: string, dialog: string) {
  const sheet = page.getByRole('dialog', { name: dialog });
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.getByRole('button', { name: button, exact: true }).click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return sheet;
}

async function expense(amount: string, description: string) {
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill(amount);
  await page.getByLabel('Descrição').fill(description);
  await pickCategory(page, CATEGORY);
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/lancamentos(\?|$)/);
}

// a linha da categoria (com a barra); o link do alerta também cita a categoria, mas não tem barra
const row = () =>
  page
    .getByRole('link')
    .filter({ hasText: CATEGORY })
    .filter({ has: page.getByRole('progressbar') });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('o menu Mais leva a Orçamentos; sem orçamento, a tela explica', async () => {
  await page.goto('/mais');
  await page.getByRole('link', { name: /Orçamentos/ }).click();
  await expect(page).toHaveURL(/\/orcamentos/);
  await expect(page.getByText(/Nenhum orçamento em/)).toBeVisible();
  await noHorizontalScroll();
});

test('cadastrar o limite de uma categoria e o teto do mês', async () => {
  await page.goto('/orcamentos');
  let sheet = await openSheet('Novo orçamento', 'Novo orçamento');
  await sheet.getByLabel('O que acompanhar').selectOption({ label: CATEGORY });
  await sheet.getByLabel('Limite por mês').fill('100,00');
  await noHorizontalScroll();
  await sheet.getByRole('button', { name: 'Salvar' }).click();
  await expect(sheet).toBeHidden();
  await expect(row()).toContainText('No controle');

  sheet = await openSheet('Novo orçamento', 'Novo orçamento');
  await sheet.getByLabel('O que acompanhar').selectOption({ label: 'Teto do mês (todos os gastos)' });
  await sheet.getByLabel('Limite por mês').fill('1.000.000,00');
  await sheet.getByRole('button', { name: 'Salvar' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('budget-cap')).toBeVisible();
  // a categoria e o teto já cadastrados saem da lista de opções
  sheet = await openSheet('Novo orçamento', 'Novo orçamento');
  await expect(sheet.getByLabel('O que acompanhar').locator('option', { hasText: CATEGORY })).toHaveCount(0);
  await expect(
    sheet.getByLabel('O que acompanhar').locator('option', { hasText: 'Teto do mês' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('gastou 85%: alerta "perto do limite" na tela e na Início', async () => {
  await expense('85,00', 'Presente da Ana');
  await page.goto('/orcamentos');
  await expect(row()).toContainText('Perto do limite');
  await expect(row()).toContainText('85%');
  await expect(page.getByTestId('budget-alerts')).toContainText(`${CATEGORY} está em 85% do orçamento`);
  await expect(page.getByTestId('budget-alerts')).toContainText(brl('15,00'));
  await noHorizontalScroll();

  await page.goto('/');
  await expect(page.getByTestId('home-budgets')).toContainText(CATEGORY);
  await expect(page.getByTestId('home-budgets')).toContainText('Perto do limite');
  await noHorizontalScroll();
});

test('passou do limite: alerta "passou" com quanto passou', async () => {
  await expense('20,00', 'Presente do Bruno');
  await page.goto('/orcamentos');
  await expect(row()).toContainText('Passou');
  await expect(page.getByTestId('budget-alerts')).toContainText(`${CATEGORY} passou do orçamento (105%)`);
  await expect(page.getByTestId('budget-alerts')).toContainText(brl('5,00'));
});

test('detalhe: histórico de 6 meses, mudar o valor e parar de acompanhar', async () => {
  await page.goto('/orcamentos');
  await row().click();
  await expect(page).toHaveURL(/\/orcamentos\/[0-9a-f-]{36}/);
  await expect(page.getByRole('img', { name: /Gasto Mensal × orçamento de Presentes/ })).toBeVisible();
  await noHorizontalScroll();

  let sheet = await openSheet('Mudar o valor', CATEGORY);
  await sheet.getByLabel('Limite por mês').fill('200,00');
  await sheet.getByRole('button', { name: 'Salvar' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('No controle')).toBeVisible();
  await expect(page.getByText(/52%/)).toBeVisible();

  sheet = await openSheet('Parar de acompanhar', `Parar de acompanhar ${CATEGORY}`);
  await sheet.getByRole('button', { name: 'Parar de acompanhar' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(/Sem orçamento em/)).toBeVisible();
  await expect(page.getByText('parou de acompanhar')).toBeVisible();

  await page.goto('/orcamentos');
  await expect(row()).toHaveCount(0);
});
