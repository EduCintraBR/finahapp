/**
 * Fase 4 no navegador (375px): Home (caixa do mês, Mensal × Bruto), relatórios e projeção.
 * Roda depois de fase2/fase3 (mesmo banco): os números vêm do que aqueles testes lançaram.
 */
import { expect, test } from '@playwright/test';
import { e2eEnv } from './env';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEnv.users.eduardo.email);
  await page.getByLabel('Senha').fill(e2eEnv.users.eduardo.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible();
});

test('Home: caixa do mês, gasto Mensal × Bruto e últimos lançamentos; bate com o relatório', async ({
  page,
}) => {
  await expect(page.getByText(/Saldo atual/)).toBeVisible();
  await expect(page.getByText(/Previsto no fim do mês/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Gastos por categoria/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Saídas por mês/ })).toBeVisible();
  await expect(page.getByText('Gastos do mês')).toBeVisible();
  await expect(page.getByText('Últimos lançamentos')).toBeVisible();
  const mensal = await page.getByTestId('spend-monthly').innerText();
  const bruto = await page.getByTestId('spend-gross').innerText();
  expect(mensal).toMatch(/R\$/);
  await page.screenshot({ path: 'test-results/fase4-home.png', fullPage: true });
  // sem rolagem horizontal em 375px
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page
    .locator('[data-slot=card]')
    .filter({ hasText: 'Gastos do mês' })
    .getByRole('link', { name: 'Detalhes' })
    .click();
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  await expect(page.getByTestId('report-total')).toHaveText(mensal);

  await page.getByRole('tab', { name: 'Bruto (compras)' }).click();
  await expect(page.getByText(/^Gasto Bruto ·/)).toBeVisible();
  await expect(page.getByTestId('report-total')).toHaveText(bruto);
  await expect(page.getByRole('list', { name: 'Gasto por categoria' })).toBeVisible();
  await expect(page.getByText('Evolução · 12 meses')).toBeVisible();
  await expect(page.locator('.recharts-line')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/fase4-relatorios.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('Relatórios: filtro de cartão mostra só o lado cartão', async ({ page }) => {
  await page.goto('/relatorios?visao=bruto');
  await page.getByText('Filtros', { exact: true }).click();
  const cardOption = page.getByLabel('Cartão').locator('option').nth(1);
  await page.getByLabel('Cartão').selectOption((await cardOption.getAttribute('value'))!);
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page).toHaveURL(/cartao=/);
  await expect(page.getByText('Filtros(1)')).toBeVisible();
  // a padaria do fase2 foi na conta (Pix/débito): não aparece com filtro de cartão
  await expect(page.getByRole('list', { name: 'Gasto por categoria' }).getByText('Mercado')).toHaveCount(0);
});

test('Projeção: meses futuros com saldo estimado e navegação', async ({ page }) => {
  await page.goto('/relatorios/projecao');
  await expect(page.getByText(/Saldo estimado no fim de/)).toBeVisible();
  await expect(page.getByTestId('projection-month')).toHaveCount(6);
  await page.getByRole('link', { name: '+ 3 meses' }).click();
  await expect(page.getByTestId('projection-month')).toHaveCount(9);
  await page.screenshot({ path: 'test-results/fase4-projecao.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
