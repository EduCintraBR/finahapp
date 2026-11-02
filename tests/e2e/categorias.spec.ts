/**
 * Gestão de categorias no navegador (375px): criar, usar num lançamento, editar apelidos, arquivar e restaurar.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';
import { categoryOffered, moreAction, pickCategory } from './forms';

const row = (page: Page, name: string) =>
  page.getByTestId('category-row').filter({ has: page.locator('summary').getByText(name, { exact: true }) });

/** Abre a linha só se estiver fechada (depois de salvar ela continua aberta). */
const open = async (page: Page, name: string) => {
  const r = row(page, name);
  if (!(await r.evaluate((el) => (el as HTMLDetailsElement).open))) await r.locator('summary').click();
  return r;
};

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
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
  await pickCategory(page, 'Pets');
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
  expect(await categoryOffered(page, 'Pets e bichos')).toBe(false);
  await page.goto('/lancamentos');
  await expect(page.getByRole('link', { name: /Ração do Thor/ })).toContainText('Pets e bichos');

  // restaurar
  await page.goto('/ajustes/categorias');
  const archived = row(page, 'Pets e bichos');
  await open(page, 'Pets e bichos');
  await archived.getByRole('button', { name: 'Restaurar categoria' }).click();
  await expect(page.getByText('Arquivadas')).toHaveCount(0);
  await page.goto('/lancamentos/novo');
  expect(await categoryOffered(page, 'Pets e bichos')).toBe(true);

  // limpa: o banco do E2E é compartilhado e os outros testes esperam o saldo inicial
  await page.goto('/lancamentos');
  await page.getByRole('link', { name: /Ração do Thor/ }).click();
  await moreAction(page, 'Excluir');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  // espera a exclusão terminar (volta para a lista) ANTES de conferir: na tela de detalhe o link
  // já não existe, então só checar o link passaria na hora e o próximo teste veria o saldo velho
  await page.waitForURL(/\/lancamentos(\?[^/]*)?$/);
  await expect(page.getByRole('link', { name: /Ração do Thor/ })).toHaveCount(0);
});

test('subcategoria: criar dentro de uma categoria, escolher em 2 passos, ver o rótulo e arquivar', async ({
  page,
}) => {
  await page.goto('/ajustes/categorias');
  await page.getByLabel('Nome').first().fill('Hortifruti');
  await page.getByLabel('Dentro de (opcional)').selectOption({ label: 'Mercado' });
  await page.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(page.getByText('Categoria criada.')).toBeVisible();
  await expect(row(page, 'Hortifruti')).toContainText('em Mercado');
  await expect(row(page, 'Mercado')).toContainText('1 subcategoria');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // mãe com subcategoria não pode ser arquivada nem entrar em outra
  await open(page, 'Mercado');
  await row(page, 'Mercado').getByRole('button', { name: 'Arquivar categoria' }).click();
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'tem uma subcategoria ativa' })).toBeVisible();
  await page.keyboard.press('Escape');

  // seletor em 2 passos: a mãe abre a segunda grade
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill('32,00');
  await page.getByLabel('Descrição').fill('Feira da semana');
  const dialog = page.getByRole('dialog', { name: 'Categoria' });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByLabel('Categoria', { exact: true }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await dialog.getByRole('button', { name: /^Mercado/ }).click();
  await expect(dialog.getByRole('button', { name: /sem subcategoria/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Hortifruti', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Categoria', { exact: true })).toContainText('Mercado › Hortifruti');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('link', { name: /Feira da semana/ })).toContainText('Mercado › Hortifruti');

  // filtro por subcategoria em Relatórios (D76): só o que foi para ela; a mãe inclui a filha
  await page.goto('/relatorios?visao=bruto');
  await page.getByRole('button', { name: /^Filtros/ }).click();
  await page.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Mercado › Hortifruti' });
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
  await expect(page).toHaveURL(/categoria=/);
  await expect(page.getByTestId('report-total')).toHaveText(/32,00/);
  await page.getByRole('button', { name: /^Filtros/ }).click();
  await page.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Mercado' });
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
  await expect(page.getByTestId('report-total')).toHaveText(/32,00/); // Mercado só tem a Feira neste banco

  // limpa: exclui o lançamento e arquiva a subcategoria (os outros testes escolhem "Mercado" direto)
  await page.goto('/lancamentos');
  await page.getByRole('link', { name: /Feira da semana/ }).click();
  await moreAction(page, 'Excluir');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await page.waitForURL(/\/lancamentos(\?[^/]*)?$/);
  await expect(page.getByRole('link', { name: /Feira da semana/ })).toHaveCount(0);
  await page.goto('/ajustes/categorias');
  await open(page, 'Hortifruti');
  await row(page, 'Hortifruti').getByRole('button', { name: 'Arquivar categoria' }).click();
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(page.getByText('Arquivadas')).toBeVisible();
});
