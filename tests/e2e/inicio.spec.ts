/**
 * Início no celular (PLANO-UI U3): a 1ª tela, sem rolar, traz o saldo, a previsão do fim do mês, Entrou, Saiu,
 * A receber e A pagar, tudo acima da barra inferior; os pendentes vêm logo abaixo, só os 3 primeiros até o toque
 * em "Ver todos". Só lê: não cria nem altera dados.
 */
import { expect, test } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
  await page.goto('/');
});

test('saldo, previsão, Entrou, Saiu, A receber e A pagar na 1ª tela, sem rolar e sem ficar atrás da barra', async ({
  page,
}) => {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const navTop = (await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.y;
  await expect(page.getByRole('heading', { name: /^Olá, / })).toBeInViewport();
  for (const id of [
    'balance-main',
    'end-of-month',
    'kpi-entrou',
    'kpi-saiu',
    'kpi-a-receber',
    'kpi-a-pagar',
  ]) {
    const el = page.getByTestId(id);
    await expect(el, id).toBeInViewport({ ratio: 1 });
    const box = (await el.boundingBox())!;
    expect(box.y + box.height, `${id} acima da barra inferior`).toBeLessThanOrEqual(navTop);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('pendentes: até 3 na tela; "Ver todos" abre o resto no lugar', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Pendentes' });
  await expect(region).toBeVisible();
  const items = region.getByRole('listitem');
  expect(await items.count()).toBeLessThanOrEqual(3);

  const more = region.getByRole('button', { name: /^Ver todos os \d+ pendentes/ });
  if (await more.isVisible()) {
    const total = Number((await more.innerText()).match(/\d+/)![0]);
    await expect(async () => {
      if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
      await expect(items).toHaveCount(total, { timeout: 1_000 });
    }).toPass();
    await region.getByRole('button', { name: 'Ver menos' }).click();
    await expect(items).toHaveCount(3);
  }
});
