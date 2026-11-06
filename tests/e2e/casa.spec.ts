/**
 * Casa no navegador (375px, D81 a D83): trocar de área pelo logo, criar as categorias sugeridas e um local,
 * cadastrar um produto por peso, dar entrada em dois lotes (pacotes e garrafas PET), dar baixa automática (sai do
 * que vence primeiro), desfazer e buscar pelo nome e pelo código do lote. As contas exatas ficam na aceitação.
 */
import { expect, test, type Page } from '@playwright/test';
import { addDays, today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { login } from './login';

test.describe.configure({ mode: 'serial' });

let page: Page;
const hoje = today();

const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
const bottomNav = () => page.getByRole('navigation', { name: 'Navegação principal' });

/** Abre um painel (SheetAction/Dialog); repete o toque até a página hidratar. */
async function openDialog(trigger: () => ReturnType<Page['getByRole']>, dialog: string | RegExp) {
  const sheet = page.getByRole('dialog', { name: dialog });
  await expect(async () => {
    if (!(await sheet.isVisible())) await trigger().click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return sheet;
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('o logo troca de área; a Casa começa pelas categorias sugeridas', async () => {
  const menu = await openDialog(() => page.getByRole('button', { name: /Trocar de área/ }), 'Ir para');
  await menu.getByRole('link', { name: /Casa/ }).click();
  await expect(page).toHaveURL(/\/casa$/);
  await expect(page.getByRole('heading', { name: 'Casa', exact: true })).toBeVisible();
  // a Casa tem a própria barra inferior
  for (const name of ['Início', 'Estoque', 'Buscar', 'Mais'])
    await expect(bottomNav().getByRole('link', { name, exact: true })).toBeVisible();
  await noHorizontalScroll();

  await expect(async () => {
    await page.getByRole('button', { name: 'Usar categorias sugeridas' }).click({ timeout: 1_000 });
    await expect(page.getByRole('region', { name: 'Categorias' })).toBeVisible({ timeout: 2_000 });
  }).toPass();
  const grid = page.getByRole('region', { name: 'Categorias' });
  for (const name of ['Alimentos', 'Água', 'Limpeza', 'Lavanderia', 'Higiene', 'Remédios'])
    await expect(grid.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});

test('locais: criar a Despensa pelo Mais da Casa', async () => {
  await bottomNav().getByRole('link', { name: 'Mais', exact: true }).click();
  await page.getByRole('link', { name: /Locais/ }).click();
  await expect(page).toHaveURL(/\/casa\/locais$/);
  await expect(async () => {
    await page.getByLabel('Nome do local', { exact: true }).fill('Despensa');
    await page.getByRole('button', { name: 'Criar' }).click({ timeout: 1_000 });
    await expect(page.getByTestId('stock-locations')).toContainText('Despensa', { timeout: 2_000 });
  }).toPass();
  await noHorizontalScroll();
});

test('cadastrar o arroz por peso e dar a 1ª entrada', async () => {
  await page.goto('/casa');
  await page
    .getByRole('region', { name: 'Categorias' })
    .getByRole('link', { name: /Alimentos/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Alimentos' })).toBeVisible();
  await page.getByRole('link', { name: 'Produto', exact: true }).click();
  await expect(page).toHaveURL(/\/casa\/produtos\/novo/);

  await page.getByLabel('Nome', { exact: true }).fill('Arroz branco');
  await page.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Grãos' });
  await page.getByLabel('Como contar', { exact: true }).selectOption('WEIGHT');
  await page.getByLabel('Estoque mínimo (opcional)', { exact: true }).fill('10');
  await page.getByLabel('Local de costume (opcional)', { exact: true }).selectOption({ label: 'Despensa' });
  await noHorizontalScroll();
  await page.getByRole('button', { name: 'Cadastrar' }).click();

  // segue direto para a entrada, com o produto escolhido
  await expect(page).toHaveURL(/\/casa\/entrada\?produto=/);
  await expect(page.getByLabel('Produto', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await page.getByLabel('Quantas embalagens', { exact: true }).fill('2');
  await page.getByLabel('Embalagem', { exact: true }).fill('pacote');
  await page.getByLabel('Peso de cada embalagem', { exact: true }).fill('5');
  await expect(page.getByLabel('Local', { exact: true })).toHaveValue(/[0-9a-f-]{36}/); // o local de costume vem preenchido
  await page.getByLabel('Validade (opcional)', { exact: true }).fill(addDays(hoje, 300));
  await noHorizontalScroll();
  await page.getByRole('button', { name: 'Dar entrada' }).click();

  await expect(page).toHaveURL(/\/casa\/produtos\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('product-total')).toHaveText('10 kg');
  await expect(page.getByTestId('product-lots')).toContainText('ARR-01');
  await expect(page.getByTestId('product-lots')).toContainText('2 pacotes de 5 kg');
  await noHorizontalScroll();
});

test('segundo lote em garrafas PET; a baixa automática sai do que vence primeiro, e dá para desfazer', async () => {
  const sheet = await openDialog(
    () => page.getByRole('button', { name: 'Entrada', exact: true }),
    /Entrada de/,
  );
  await sheet.getByLabel('Quantas embalagens', { exact: true }).fill('11');
  await sheet.getByLabel('Embalagem', { exact: true }).fill('garrafa PET');
  await sheet.getByLabel('Peso de cada embalagem', { exact: true }).fill('1,8');
  await sheet.getByLabel('Validade (opcional)', { exact: true }).fill(addDays(hoje, 20));
  await sheet.getByRole('button', { name: 'Dar entrada' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('product-total')).toHaveText('29,8 kg');
  // as garrafas vencem antes: vêm primeiro, marcadas, e o produto mostra a validade próxima
  const lots = page.getByTestId('product-lots').getByRole('listitem');
  await expect(lots.first()).toContainText('ARR-02');
  await expect(lots.first()).toContainText('Usar primeiro');

  const use = await openDialog(() => page.getByRole('button', { name: 'Usei', exact: true }), /Usei/);
  await use.getByLabel('Quantas embalagens', { exact: true }).fill('2');
  await use.getByRole('button', { name: 'Dar baixa' }).click();
  await expect(use).toBeHidden();
  await expect(page.getByTestId('product-total')).toHaveText('26,2 kg');
  const history = page.getByTestId('product-history').getByRole('listitem');
  await expect(history.first()).toContainText('Usei · ARR-02');

  await history.first().getByRole('button', { name: 'Desfazer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.getByTestId('product-total')).toHaveText('29,8 kg');
  await expect(history.first()).toContainText('desfeito');
});

test('busca pelo nome, sem acento, e pelo código do lote; o que não tem oferece cadastrar', async () => {
  await bottomNav().getByRole('link', { name: 'Buscar', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Buscar no estoque' });
  await search.fill('ARROZ');
  await search.press('Enter');
  await expect(page.getByTestId('stock-products')).toContainText('Arroz branco');
  await expect(page.getByTestId('stock-products')).toContainText('29,8 kg');

  await page.getByRole('searchbox', { name: 'Buscar no estoque' }).fill('arr-01');
  await page.getByRole('searchbox', { name: 'Buscar no estoque' }).press('Enter');
  await expect(page.getByTestId('stock-products')).toContainText('Arroz branco');

  await page.getByRole('searchbox', { name: 'Buscar no estoque' }).fill('feijão');
  await page.getByRole('searchbox', { name: 'Buscar no estoque' }).press('Enter');
  await expect(page.getByRole('link', { name: 'Cadastrar “feijão”' })).toBeVisible();
  await noHorizontalScroll();
});

test('envasar um pacote em 2 garrafas PET: o lote novo nasce com código e o total não muda', async () => {
  await page.getByRole('searchbox', { name: 'Buscar no estoque' }).fill('arroz');
  await page.getByRole('searchbox', { name: 'Buscar no estoque' }).press('Enter');
  await page
    .getByTestId('stock-products')
    .getByRole('link', { name: /Arroz branco/ })
    .click();
  await expect(page).toHaveURL(/\/casa\/produtos\/[0-9a-f-]{36}$/);

  const sheet = await openDialog(() => page.getByRole('button', { name: 'Envasar', exact: true }), /Envasar/);
  await sheet.getByLabel(/ARR-01/).fill('1');
  await sheet.getByLabel('Quantas embalagens saíram do envase', { exact: true }).fill('2');
  await sheet.getByLabel('Peso de cada embalagem', { exact: true }).fill('2,5');
  await sheet.getByLabel('Validade (opcional)', { exact: true }).fill(addDays(hoje, 400));
  await sheet.getByLabel('Observações (opcional)', { exact: true }).fill('com absorvedor');
  await sheet.getByRole('button', { name: 'Envasar', exact: true }).click();
  // envasar leva direto ao lote novo (o QR da etiqueta abre o mesmo lugar)
  await expect(page).toHaveURL(/\/casa\/lotes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'ARR-03' })).toBeVisible();
  await expect(page.getByTestId('lot-quantity')).toContainText('2 garrafas PET de 2,5 kg');
  await expect(page.getByText('Envasado de')).toBeVisible();
  await noHorizontalScroll();

  // o total do produto não mudou: 1 pacote de 5 kg + 2 garrafas de 2,5 kg + 19,8 kg das outras garrafas
  await page.getByRole('link', { name: 'Arroz branco' }).first().click();
  await expect(page.getByTestId('product-total')).toHaveText('29,8 kg');
  await expect(page.getByTestId('product-lots')).toContainText('1 pacote de 5 kg');
});

test('o lote do QR: "Abri 1" dá baixa num toque e "Conferi" registra a conferência', async () => {
  await page.getByTestId('product-lots').getByRole('link', { name: 'ARR-03' }).click();
  await expect(page).toHaveURL(/\/casa\/lotes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('lot-quantity')).toContainText('2 garrafas PET de 2,5 kg');
  await expect(page.getByText('Envasado de')).toBeVisible();
  await noHorizontalScroll();

  await page.getByRole('button', { name: 'Abri 1 garrafa PET' }).click();
  await expect(page.getByTestId('lot-quantity')).toContainText('1 garrafa PET de 2,5 kg');
  await expect(page.getByTestId('lot-history').getByRole('listitem').first()).toContainText('Usei');

  const check = await openDialog(
    () => page.getByRole('button', { name: 'Conferi', exact: true }),
    /Conferi o ARR-03/,
  );
  await check.getByLabel('O que viu (opcional)', { exact: true }).fill('tudo seco');
  await check.getByRole('button', { name: /Registrar|Conferi/ }).click();
  await expect(check).toBeHidden();
  await expect(page.getByTestId('lot-checks')).toContainText('tudo seco');
});

test('etiquetas: 1/4 de A4 por embalagem, com QR; dá para pular posições da folha', async () => {
  await page.getByRole('link', { name: 'Imprimir etiquetas' }).click();
  await expect(page).toHaveURL(/\/casa\/etiquetas\?lote=/);
  await expect(page.getByRole('heading', { name: 'Etiquetas' })).toBeVisible();
  const sheet1 = page.getByRole('region', { name: 'Folha 1' });
  await expect(sheet1.getByAltText('QR do lote ARR-03')).toHaveCount(1);
  await expect(sheet1).toContainText('ARR-03');

  await page.getByLabel('Quantas etiquetas', { exact: true }).fill('3');
  await page.getByLabel('Começar na posição', { exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByRole('region', { name: 'Folha 2' })).toBeVisible();
  await expect(page.getByAltText('QR do lote ARR-03')).toHaveCount(3);
  await expect(page.getByText('Posição já usada')).toHaveCount(5);
});

test('a Início da Casa avisa o lote que vence em breve', async () => {
  await page.goto('/casa');
  await expect(page.getByRole('region', { name: 'Vencidos e vencendo' })).toContainText('ARR-02');
  await noHorizontalScroll();
});

test('a volta para as Finanças pelo Mais da Casa', async () => {
  await bottomNav().getByRole('link', { name: 'Mais', exact: true }).click();
  await page.getByRole('link', { name: /Finanças/ }).click();
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible();
  await expect(bottomNav().getByRole('link', { name: 'Lançamentos' })).toBeVisible();
});
