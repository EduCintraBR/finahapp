/**
 * Menu Categorias no navegador (375px, D77): categorias e subcategorias com cadastros separados, edição da categoria
 * com as subcategorias dela (+ e remover), uso num lançamento, arquivar e restaurar.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';
import { categoryOffered, moreAction, pickCategory } from './forms';

const row = (page: Page, name: string) =>
  page.getByTestId('category-row').filter({ has: page.getByText(name, { exact: true }) });

/** Abre a edição a partir da lista de categorias. */
const edit = async (page: Page, name: string) => {
  await page.goto('/categorias');
  await row(page, name).getByRole('link').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
};

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
});

test('criar, usar, editar apelidos, arquivar e restaurar uma categoria', async ({ page }) => {
  // menu próprio no "Mais", fora de Ajustes
  await page.goto('/mais');
  await page.getByRole('link', { name: /^Categorias/ }).click();
  await expect(page.getByRole('heading', { name: 'Categorias' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Categorias', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // criar: nasce sem subcategoria e abre a própria edição
  await page.getByRole('link', { name: 'Nova', exact: true }).click();
  await page.getByLabel('Nome').fill('Pets');
  await page.getByLabel('Apelidos (opcional)').fill('Ração, Petshop');
  await page.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(page.getByRole('heading', { name: 'Pets', exact: true })).toBeVisible();
  await expect(page.getByText('Nenhuma subcategoria. Toque em + para criar.')).toBeVisible();
  await page.goto('/categorias');
  await expect(row(page, 'Pets')).toContainText('Sem lançamentos');
  await expect(row(page, 'Pets')).toContainText('racao, petshop');
  await page.screenshot({ path: 'test-results/categorias.png', fullPage: true });
  await noHorizontalScroll(page);

  // repetida e apelido de outra categoria
  await page.goto('/categorias/nova');
  await page.getByLabel('Nome').fill('pets');
  await page.getByRole('button', { name: 'Criar categoria' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Já existe uma categoria chamada "Pets"' }),
  ).toBeVisible();
  await page.getByLabel('Nome').fill('Bichos');
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
  await page.goto('/categorias');
  await expect(row(page, 'Pets')).toContainText('1 lançamento');
  await edit(page, 'Pets');
  await page.getByLabel('Nome').fill('Pets e bichos');
  await page.getByLabel('Apelidos').fill('racao, petshop, veterinario');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  await page.goto('/categorias');
  await expect(row(page, 'Pets e bichos')).toContainText('veterinario');

  // categorias de fallback: nome travado e sem arquivar
  await edit(page, 'A classificar');
  await expect(page.getByLabel('Nome')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Arquivar categoria' })).toHaveCount(0);

  // arquivar (com confirmação): some dos lançamentos novos, o lançamento antigo continua com ela
  await edit(page, 'Pets e bichos');
  await page.getByRole('button', { name: 'Arquivar categoria' }).click();
  await expect(page.getByText(/Os 1 lançamentos que já usam a categoria/)).toBeVisible();
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(page.getByText('Arquivada', { exact: true })).toBeVisible();
  await page.goto('/lancamentos/novo');
  expect(await categoryOffered(page, 'Pets e bichos')).toBe(false);
  await page.goto('/lancamentos');
  await expect(page.getByRole('link', { name: /Ração do Thor/ })).toContainText('Pets e bichos');

  // restaurar (fica em "Arquivadas" na lista)
  await page.goto('/categorias');
  await expect(page.getByRole('region', { name: 'Arquivadas' })).toContainText('Pets e bichos');
  await row(page, 'Pets e bichos').getByRole('link').click();
  await page.getByRole('button', { name: 'Restaurar categoria' }).click();
  await expect(page.getByText('Arquivada', { exact: true })).toHaveCount(0);
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

test('subcategoria: + na edição da categoria, aba própria, escolher em 2 passos e remover', async ({
  page,
}) => {
  // o + da categoria abre o cadastro de subcategoria com ela já escolhida, e volta para ela
  await edit(page, 'Mercado');
  await page.getByRole('link', { name: 'Nova subcategoria' }).click();
  await expect(page.getByRole('heading', { name: 'Nova subcategoria' })).toBeVisible();
  await expect(page.getByLabel('Categoria').locator('option:checked')).toHaveText('Mercado');
  await page.getByLabel('Nome').fill('Hortifruti');
  await page.getByRole('button', { name: 'Criar subcategoria' }).click();
  await expect(page.getByRole('heading', { name: 'Mercado', exact: true })).toBeVisible();
  const subs = page.getByRole('region', { name: 'Subcategorias', exact: true });
  await expect(subs.getByTestId('category-row')).toHaveCount(1);
  await expect(row(page, 'Hortifruti')).toContainText('Sem lançamentos');
  await noHorizontalScroll(page);

  // categoria com subcategoria não pode ser arquivada nem virar subcategoria
  await expect(page.getByLabel('Transformar em subcategoria de…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Arquivar categoria' }).click();
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'tem uma subcategoria ativa' })).toBeVisible();
  await page.keyboard.press('Escape');

  // aba Subcategorias: cada uma com a categoria dela; a lista de categorias só conta
  await page.goto('/categorias/subcategorias');
  await expect(row(page, 'Hortifruti')).toContainText('Mercado');
  await noHorizontalScroll(page);
  await page.goto('/categorias');
  await expect(row(page, 'Mercado')).toContainText('1 subcategoria');
  await expect(row(page, 'Hortifruti')).toHaveCount(0);

  // seletor em 2 passos: a categoria abre a segunda grade
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

  // filtro por subcategoria em Relatórios (D76): só o que foi para ela; a categoria inclui a subcategoria
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

  // limpa o lançamento
  await page.goto('/lancamentos');
  await page.getByRole('link', { name: /Feira da semana/ }).click();
  await moreAction(page, 'Excluir');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await page.waitForURL(/\/lancamentos(\?[^/]*)?$/);
  await expect(page.getByRole('link', { name: /Feira da semana/ })).toHaveCount(0);

  // remover pela lixeira na edição da categoria: arquiva (os outros testes escolhem "Mercado" direto)
  await edit(page, 'Mercado');
  await page.getByRole('button', { name: 'Remover Hortifruti' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Fica em "Arquivadas" e pode ser restaurada.');
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(page.getByText('Nenhuma subcategoria. Toque em + para criar.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Subcategorias arquivadas' })).toContainText('Hortifruti');
});
