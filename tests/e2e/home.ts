import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Um pendente na lista da Início. A lista mostra só os 3 primeiros (U3): se houver mais, abre a lista inteira antes
 * de procurar. O clique repete até a página hidratar (antes disso o botão ainda não responde).
 */
export async function homePending(page: Page, text: string) {
  const region = page.getByRole('region', { name: 'Pendentes' });
  await expect(region).toBeVisible();
  const more = region.getByRole('button', { name: /^Ver todos os \d+ pendentes|^Ver menos/ });
  if (await more.isVisible()) {
    await expect(async () => {
      if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
    }).toPass();
  }
  return region.getByRole('listitem').filter({ hasText: text });
}

/**
 * Toca em "Paguei" (ou "Recebi") de um pendente até o painel de baixa abrir. Antes de a página hidratar o botão não
 * responde; no CI, mais lento, um toque só às vezes se perdia e o teste esperava o painel até estourar o tempo.
 */
export async function openPayment(page: Page, item: Locator, name = 'Paguei') {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await item.getByRole('button', { name }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return dialog;
}
