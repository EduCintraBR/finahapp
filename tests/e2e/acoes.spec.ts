/**
 * Ações frequentes no celular (PLANO-UI, Fase D): o formulário de novo lançamento cabe na 1ª tela com o "Lançar"
 * sempre à vista acima da barra inferior; a categoria é escolhida numa grade em painel, com busca sem acento.
 * Só lê: não cria nem altera dados.
 */
import { expect, test } from '@playwright/test';
import { e2eEnv } from './env';
import { pickCategory } from './forms';
import { login } from './login';

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
  await page.goto('/lancamentos/novo');
});

test('novo lançamento: valor, descrição, categoria, data, "Já paguei" e "Lançar" na 1ª tela, sem rolar', async ({
  page,
}) => {
  const navTop = (await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.y;
  const fields = {
    valor: page.getByLabel('Valor'),
    descrição: page.getByLabel('Descrição'),
    categoria: page.getByLabel('Categoria', { exact: true }),
    data: page.locator('#date'),
    'já paguei': page.getByLabel('Já paguei'),
    lançar: page.getByRole('button', { name: 'Lançar' }),
  };
  for (const [name, el] of Object.entries(fields)) {
    await expect(el, name).toBeInViewport({ ratio: 1 });
    const box = (await el.boundingBox())!;
    expect(box.y + box.height, `${name} acima da barra inferior`).toBeLessThanOrEqual(navTop);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('categoria em grade: busca sem acento, um toque escolhe; sem categoria, avisa antes de enviar', async ({
  page,
}) => {
  await page.getByLabel('Valor').fill('1234');
  await page.getByLabel('Descrição').fill('Sem categoria');

  // escolher e trocar (a busca ignora acentos)
  await pickCategory(page, 'Mercado');
  const field = page.getByLabel('Categoria', { exact: true });
  await expect(field).toContainText('Mercado');
  await field.click();
  const picker = page.getByRole('dialog', { name: 'Categoria' });
  await picker.getByLabel('Buscar categoria').fill('saude');
  await expect(picker.getByRole('button', { name: 'Saúde', exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Mercado', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Saúde', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(field).toContainText('Saúde');

  // trocar o tipo para Receita limpa a categoria de despesa: "Lançar" avisa em vez de enviar
  await page.getByRole('radio', { name: 'Receita' }).click();
  await expect(field).toContainText('Escolha…');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Escolha uma categoria.' })).toBeVisible();
  await expect(page).toHaveURL(/\/lancamentos\/novo/);
});
