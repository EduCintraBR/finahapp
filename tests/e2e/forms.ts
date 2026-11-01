import { expect, type Page } from '@playwright/test';

const field = (page: Page) => page.getByLabel('Categoria', { exact: true });
const picker = (page: Page) => page.getByRole('dialog', { name: 'Categoria' });

const isSelect = async (page: Page) => (await field(page).evaluate((el) => el.tagName)) === 'SELECT';

/** Abre a grade de categorias do lançamento; repete o toque até a página hidratar. */
async function openPicker(page: Page) {
  await expect(async () => {
    if (!(await picker(page).isVisible())) await field(page).click();
    await expect(picker(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Escolhe a categoria: no lançamento é a grade em painel (CategoryPicker); nos outros formulários, um select. */
export async function pickCategory(page: Page, name: string) {
  if (await isSelect(page)) {
    await field(page).selectOption({ label: name });
    return;
  }
  await openPicker(page);
  await picker(page).getByRole('button', { name, exact: true }).click();
  await expect(picker(page)).toBeHidden();
}

/** A categoria está entre as opções do campo? */
export async function categoryOffered(page: Page, name: string): Promise<boolean> {
  if (await isSelect(page)) return (await field(page).locator('option', { hasText: name }).count()) > 0;
  await openPicker(page);
  const n = await picker(page).getByRole('button', { name, exact: true }).count();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  return n > 0;
}

/** Ação do menu "⋯" (Mais ações) de uma tela de detalhe; repete o toque até a página hidratar. */
export async function moreAction(page: Page, name: string) {
  const menu = page.getByRole('dialog', { name: 'Mais ações' });
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Mais ações' }).click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await menu.getByRole('button', { name, exact: true }).click();
}
