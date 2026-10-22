/**
 * Login no E2E com o 2FA obrigatório (D64).
 * - Eduardo já começa com o autenticador ativo (global-setup) e um estoque de códigos de recuperação: cada login
 *   gasta um (o código de 6 dígitos não pode ser reusado no mesmo passo de 30 s, e o E2E entra várias vezes).
 * - Viviane começa sem autenticador: o 1º login dela faz o cadastro pela tela (QR / chave).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { base32Encode, totpCode, totpStep } from '../../src/server/auth/totp';

export const E2E_TOTP_SECRET = base32Encode(Buffer.from('finah-e2e-totp-secret!'));
/** Códigos determinísticos e distintos (sha256 do índice → 8 caracteres base32). */
export const RECOVERY_POOL = Array.from({ length: 300 }, (_, i) => {
  const raw = base32Encode(createHash('sha256').update(`e2e:${i}`).digest().subarray(0, 5)).toLowerCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
});

/** Contador em disco: sobrevive ao reinício do worker do Playwright depois de um teste que falha. */
export const COUNTER_FILE = 'test-results/.e2e-login-counter';

export function resetLoginCounter() {
  mkdirSync(dirname(COUNTER_FILE), { recursive: true });
  writeFileSync(COUNTER_FILE, '0');
}

function nextRecoveryCode(): string {
  const n = existsSync(COUNTER_FILE) ? Number(readFileSync(COUNTER_FILE, 'utf8')) || 0 : 0;
  writeFileSync(COUNTER_FILE, String(n + 1));
  const code = RECOVERY_POOL[n];
  if (!code) throw new Error('E2E: acabaram os códigos de recuperação de teste (aumente RECOVERY_POOL).');
  return code;
}

export async function fillPassword(page: Page, user: { email: string; password: string }) {
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Continuar' }).click();
}

/** Entra com senha + 2º fator e espera a home. */
export async function login(
  page: Page,
  user: { email: string; password: string },
  opts: { goto?: boolean } = {},
) {
  if (opts.goto !== false) await page.goto('/login');
  await fillPassword(page, user);
  const code = page.getByLabel('Código');
  await expect(code).toBeVisible();
  const secret = page.getByTestId('totp-secret');
  if (await secret.isVisible()) {
    // 1º login: cadastra o autenticador com a chave mostrada na tela
    const key = (await secret.textContent())!.trim();
    await code.fill(totpCode(key, totpStep(Date.now())));
    await page.getByRole('button', { name: 'Ativar e entrar' }).click();
  } else {
    await code.fill(nextRecoveryCode());
    await page.getByRole('button', { name: 'Entrar' }).click();
  }
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible();
}
