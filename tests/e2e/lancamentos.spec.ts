/**
 * Lista de Lançamentos no celular (PLANO-UI, Fase E): resumo do mês com as Saídas (U4 = Saiu + A pagar) e os
 * filtros em botões que abrem um painel, guardados na URL. Só lê: não cria nem altera dados.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';

const cents = (text: string) => {
  const m = text.match(/(−|-)?\s*R\$\s*([\d.]+,\d{2})/);
  if (!m) throw new Error(`sem valor em "${text}"`);
  const v = Number(m[2]!.replace(/\./g, '').replace(',', ''));
  return m[1] ? -v : v;
};
const kpi = async (page: Page, slug: string) => cents(await page.getByTestId(`kpi-${slug}`).innerText());

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
  await page.goto('/lancamentos');
});

test('resumo do mês: Saídas = Saiu + A pagar, e os números são os mesmos da Início', async ({ page }) => {
  const [saiu, aPagar, saidas, entrou] = [
    await kpi(page, 'saiu'),
    await kpi(page, 'a-pagar'),
    await kpi(page, 'saidas'),
    await kpi(page, 'entrou'),
  ];
  expect(saidas).toBe(saiu + aPagar);
  await page.goto('/');
  expect(await kpi(page, 'saiu')).toBe(saiu);
  expect(await kpi(page, 'a-pagar')).toBe(aPagar);
  expect(await kpi(page, 'entrou')).toBe(entrou);
});

test('filtros em botões: escolher no painel muda a URL e a lista; "Limpar filtros" volta', async ({
  page,
}) => {
  const tipo = page.getByRole('button', { name: 'Tipo' });
  await expect(async () => {
    if (!(await page.getByRole('dialog', { name: 'Tipo' }).isVisible())) await tipo.click();
    await expect(page.getByRole('dialog', { name: 'Tipo' })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page
    .getByRole('dialog', { name: 'Tipo' })
    .getByRole('link', { name: 'Receitas', exact: true })
    .click();
  await expect(page).toHaveURL(/tipo=INCOME/);
  await expect(page.getByRole('button', { name: 'Tipo: Receitas' })).toBeVisible();
  // só receitas na lista (valores com "+")
  for (const amount of await page
    .locator('main a[href^="/lancamentos/"] [class*="tabular-nums"]')
    .allInnerTexts())
    expect(amount).not.toMatch(/−/);

  await page.getByRole('link', { name: 'Limpar filtros' }).click();
  await expect(page).not.toHaveURL(/tipo=/);
  await expect(page.getByRole('button', { name: 'Tipo', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
