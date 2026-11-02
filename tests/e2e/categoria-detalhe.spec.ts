/**
 * Detalhe da categoria (D75) no navegador (375px): da pizza da Início e de Relatórios, a lista que soma a fatia,
 * e a troca rápida de categoria sem sair da tela.
 */
import { expect, test } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';
import { moreAction, pickCategory } from './forms';

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
});

test('abrir a categoria pela pizza e por Relatórios, e trocar a categoria de um lançamento', async ({
  page,
}) => {
  // um gasto novo em Mercado, no mês atual
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill('12,34');
  await page.getByLabel('Descrição').fill('Detalhe da categoria');
  await pickCategory(page, 'Mercado');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('link', { name: /Detalhe da categoria/ })).toBeVisible();

  // da Início: a legenda da pizza leva ao detalhe (Gasto Bruto), e "Início" volta
  await page.goto('/');
  const legend = page.getByRole('list', { name: 'Legenda das categorias' });
  await expect(legend).toBeVisible();
  await legend.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/relatorios\/categoria\/.+visao=bruto.+de=inicio/);
  await expect(page.getByTestId('category-total')).toBeVisible();
  await expect(page.getByText(/Gasto Bruto ·/)).toBeVisible();
  await page.getByRole('link', { name: 'Início' }).first().click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  // de Relatórios: a categoria leva ao detalhe do mesmo modo; o total é o da fatia
  await page.goto('/relatorios?visao=bruto');
  const sliceTotal = page
    .getByRole('list', { name: 'Gasto por categoria' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Mercado', exact: true }) });
  const expected = (await sliceTotal.locator('.tabular-nums').first().innerText()).trim();
  await page
    .getByRole('list', { name: 'Gasto por categoria' })
    .getByRole('link', { name: 'Mercado', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Mercado' })).toBeVisible();
  await expect(page.getByTestId('category-total')).toHaveText(expected);
  const line = page.getByTestId('category-line').filter({ hasText: 'Detalhe da categoria' });
  await expect(line).toContainText('12,34');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: 'test-results/categoria-detalhe.png', fullPage: true });

  // trocar a categoria: a linha sai de Mercado e aparece em Lazer
  const change = line.getByRole('button', { name: 'Trocar a categoria de Detalhe da categoria' });
  const dialog = page.getByRole('dialog', { name: 'Trocar categoria' });
  await expect(async () => {
    if (!(await dialog.isVisible())) await change.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  // o seletor é outro diálogo, de nome exato 'Categoria' (o helper casaria também 'Trocar categoria')
  await dialog.getByRole('button', { name: 'Categoria', exact: true }).click();
  const grid = page.getByRole('dialog', { name: 'Categoria', exact: true });
  await grid.getByRole('button', { name: 'Lazer', exact: true }).click();
  await expect(grid).toBeHidden();
  await dialog.getByRole('button', { name: 'Trocar categoria' }).click();
  await expect(page.getByTestId('category-line').filter({ hasText: 'Detalhe da categoria' })).toHaveCount(0);

  await page.goto('/relatorios?visao=bruto');
  await page
    .getByRole('list', { name: 'Gasto por categoria' })
    .getByRole('link', { name: 'Lazer', exact: true })
    .click();
  const moved = page.getByTestId('category-line').filter({ hasText: 'Detalhe da categoria' });
  await expect(moved).toContainText('Lazer');

  // limpa: o banco do E2E é compartilhado e os outros testes esperam o saldo inicial
  await moved.getByRole('link').click();
  await moreAction(page, 'Excluir');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await page.waitForURL(/\/lancamentos(\?[^/]*)?$/);
  await expect(page.getByRole('link', { name: /Detalhe da categoria/ })).toHaveCount(0);
});
