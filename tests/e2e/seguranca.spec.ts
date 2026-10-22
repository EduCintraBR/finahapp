/**
 * Segurança no navegador (D64): cabeçalhos e CSP (sem violação na página), 2FA no login, sessão derrubada por
 * "sair de todos os aparelhos" e troca de senha, e callbackUrl que não leva para outro site.
 */
import { expect, test } from '@playwright/test';
import { e2eEnv } from './env';
import { fillPassword, login } from './login';

const { eduardo } = e2eEnv.users;

test('cabeçalhos de segurança e CSP com nonce, sem nenhuma violação na página', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto('/login');
  const h = res!.headers();
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('same-origin');
  await login(page, eduardo, { goto: false });
  await page.goto('/relatorios'); // gráficos (Recharts) e scripts do Next rodam com o CSP
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('senha certa não basta: código errado é recusado', async ({ page }) => {
  await page.goto('/login');
  await fillPassword(page, eduardo);
  await page.getByLabel('Código').fill('000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Código inválido' })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('callbackUrl para outro site é ignorado depois do login', async ({ page }) => {
  await page.goto('/login?callbackUrl=%2F%5Cevil.example');
  await login(page, eduardo, { goto: false });
  await expect(page).toHaveURL(/localhost:3100\/$/);
});

test('sair de todos os aparelhos derruba uma sessão copiada', async ({ page, browser }) => {
  await login(page, eduardo);
  const stolen = await page.context().storageState(); // "outro aparelho" com o mesmo cookie
  await page.goto('/ajustes');
  await page.getByRole('button', { name: 'Sair de todos os aparelhos' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sair de todos' }).click();
  await expect(page).toHaveURL(/\/login/);

  const other = await browser.newContext({ storageState: stolen });
  const p2 = await other.newPage();
  await p2.goto('/');
  await expect(p2).toHaveURL(/\/login/);
  await other.close();
});

test('trocar a senha: entra de novo com a nova (e volta a original)', async ({ page }) => {
  const change = async (current: string, next: string) => {
    await page.goto('/ajustes');
    await page.locator('summary', { hasText: 'Trocar senha' }).click();
    await page.getByLabel('Senha atual').fill(current);
    await page.getByLabel('Nova senha', { exact: true }).fill(next);
    await page.getByLabel('Repita a nova senha').fill(next);
    await page.getByRole('button', { name: 'Trocar senha' }).click();
    await expect(page).toHaveURL(/\/login/);
  };
  await login(page, eduardo);
  await change(eduardo.password, 'uma-senha-nova-bem-longa');
  await login(page, { ...eduardo, password: 'uma-senha-nova-bem-longa' }, { goto: false });
  await change('uma-senha-nova-bem-longa', eduardo.password);
  await login(page, eduardo, { goto: false });
});
