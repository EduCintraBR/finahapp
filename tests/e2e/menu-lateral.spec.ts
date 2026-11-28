/**
 * Menu lateral no iPad e no desktop (≥ md, D96): o botão do cabeçalho esconde e mostra o menu, a escolha fica no
 * aparelho (vale ao recarregar e em outras telas) e, com o menu escondido, a troca de área volta para o cabeçalho.
 * No celular o botão não existe. Só navega: não cria nem altera dados.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';

const sidebar = (page: Page) => page.locator('#app-sidebar');
const hideButton = (page: Page) => page.getByRole('button', { name: 'Esconder menu' });
const showButton = (page: Page) => page.getByRole('button', { name: 'Mostrar menu' });
const areaMenu = (page: Page) => page.getByRole('button', { name: /Trocar de área/ });

test.describe('iPad (1024 × 768)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test.beforeEach(async ({ page }) => {
    await login(page, e2eEnv.users.eduardo);
  });

  test('esconde e mostra o menu; a escolha fica no aparelho', async ({ page }) => {
    await expect(sidebar(page)).toBeVisible();
    await expect(hideButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(areaMenu(page)).toBeHidden();
    const mainBefore = await page.locator('main').boundingBox();

    await hideButton(page).click();
    await expect(sidebar(page)).toBeHidden();
    await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false');
    // sem o menu, a troca de área (Finanças ou Casa) fica no cabeçalho, e o conteúdo usa a largura toda
    await expect(areaMenu(page)).toBeVisible();
    const mainAfter = await page.locator('main').boundingBox();
    expect(mainAfter!.x).toBeLessThan(mainBefore!.x);

    // recarregar e trocar de tela mantém o menu escondido (sem aparecer e sumir)
    await page.reload();
    await expect(sidebar(page)).toBeHidden();
    await page.goto('/lancamentos');
    await expect(sidebar(page)).toBeHidden();
    await expect(showButton(page)).toBeVisible();

    await showButton(page).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(areaMenu(page)).toBeHidden();
    await page.reload();
    await expect(sidebar(page)).toBeVisible();
  });
});

test('celular: sem botão de esconder o menu', async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
  await expect(page.getByRole('button', { name: /(Esconder|Mostrar) menu/ })).toHaveCount(0);
  await expect(sidebar(page)).toBeHidden();
});
