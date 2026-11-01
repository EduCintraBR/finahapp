import { expect, type Page } from '@playwright/test';

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
