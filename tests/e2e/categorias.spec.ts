/**
 * Gestão de categorias no navegador (375px): criar, usar num lançamento, editar apelidos, arquivar e restaurar.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';

const row = (page: Page, name: string) =>
  page.getByTestId('category-row').filter({ has: page.getByText(name, { exact: true }) });

/** Abre a linha só se estiver fechada (depois de salvar ela continua aberta). */
const open = async (page: Page, name: string) => {
  const r = row(page, name);
  if (!(await r.evaluate((el) => (el as HTMLDetailsElement).open))) await r.locator('summary').click();
  return r;
};

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEnv.users.eduardo.email);
  await page.getByLabel('Senha').fill(e2eEnv.users.eduardo.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible();
});

test('criar, usar, editar apelidos, arquivar e restaurar uma categoria', async ({ page }) => {
  await page.goto('/ajustes');
  await page.getByRole('link', { name: 'Gerenciar categorias' }).click();
  await expect(page.getByRole('heading', { name: 'Categorias' })).toBeVisible();

  // criar
  await page.getByLabel('Nome').first().fill('Pets');
  await page.getByLabel('Apelidos (opcional)').fill('Ração, Petshop');
  await page.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(page.getByText('Categoria criada.')).toBeVisible();
  await expect(row(page, 'Pets')).toContainText('Sem lançamentos');
  await expect(row(page, 'Pets')).toContainText('racao, petshop');
  await page.screenshot({ path: 'test-results/categorias.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // repetida e apelido de outra categoria
  await page.getByLabel('Nome').first().fill('pets');
  await page.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Já existe uma categoria chamada "Pets"' }),
  ).toBeVisible();
  await page.getByLabel('Nome').first().fill('Bichos');
  await page.getByLabel('Apelidos (opcional)').fill('super');
  await page.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'já é da categoria "Mercado"' })).toBeVisible();

  // aparece no lançamento
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill('80,00');
  await page.getByLabel('Descrição').fill('Ração do Thor');
  await page.getByLabel('Categoria').selectOption({ label: 'Pets' });
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('link', { name: /Ração do Thor/ })).toContainText('Pets');

  // editar: renomear + apelido novo; a contagem de lançamentos aparece
  await page.goto('/ajustes/categorias');
  await expect(row(page, 'Pets')).toContainText('1 lançamento');
  await open(page, 'Pets');
  await row(page, 'Pets').getByLabel('Nome').fill('Pets e bichos');
  await row(page, 'Pets').getByLabel('Apelidos').fill('racao, petshop, veterinario');
  await row(page, 'Pets').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  await expect(row(page, 'Pets e bichos')).toContainText('veterinario');

  // categorias de fallback: nome travado e sem botão de arquivar
  const fallback = row(page, 'A classificar');
  await open(page, 'A classificar');
  await expect(fallback.getByLabel('Nome')).toHaveAttribute('readonly', '');
  await expect(fallback.getByRole('button', { name: 'Arquivar categoria' })).toHaveCount(0);

  // arquivar (com confirmação): some dos lançamentos novos, o lançamento antigo continua com ela
  await open(page, 'Pets e bichos');
  await row(page, 'Pets e bichos').getByRole('button', { name: 'Arquivar categoria' }).click();
  await expect(page.getByText(/Os 1 lançamentos que já usam/)).toBeVisible();
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(page.getByText('Arquivadas')).toBeVisible();
  await page.goto('/lancamentos/novo');
  await expect(page.getByLabel('Categoria').locator('option', { hasText: 'Pets e bichos' })).toHaveCount(0);
  await page.goto('/lancamentos');
  await expect(page.getByRole('link', { name: /Ração do Thor/ })).toContainText('Pets e bichos');

  // restaurar
  await page.goto('/ajustes/categorias');
  const archived = row(page, 'Pets e bichos');
  await open(page, 'Pets e bichos');
  await archived.getByRole('button', { name: 'Restaurar categoria' }).click();
  await expect(page.getByText('Arquivadas')).toHaveCount(0);
  await page.goto('/lancamentos/novo');
  await expect(page.getByLabel('Categoria').locator('option', { hasText: 'Pets e bichos' })).toHaveCount(1);

  // limpa: o banco do E2E é compartilhado e os outros testes esperam o saldo inicial
  await page.goto('/lancamentos');
  await page.getByRole('link', { name: /Ração do Thor/ }).click();
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByRole('link', { name: /Ração do Thor/ })).toHaveCount(0);
});
