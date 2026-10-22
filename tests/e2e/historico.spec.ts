/**
 * Mês anterior ao início do controle (D50) e ferramentas da revisão (Fase 5), no navegador (375px).
 * O OFX de "setembro" é deslocado para o mês anterior ao início do controle do banco do E2E.
 * Roda depois de fase2/3/4 (que esperam o saldo inicial) e antes dos testes de importação.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addDays, addMonths, diffMonths, monthStart, today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { login } from './login';

function previousMonthFixture(): Buffer {
  const shift = Math.max(0, diffMonths(today(), '2026-10-18'));
  const text = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account-sep.ofx'), 'utf8').replace(
    /<(DTPOSTED|DTSTART|DTEND|DTASOF)>(\d{4})(\d{2})(\d{2})/g,
    (_, tag: string, y: string, m: string, d: string) =>
      `<${tag}>${addMonths(`${y}-${m}-${d}`, shift).replace(/-/g, '')}`,
  );
  return Buffer.from(text, 'utf8');
}

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
});

test('importar o mês anterior ao início: mostra o recuo, confirma, ignora em lote e troca o match', async ({
  page,
}) => {
  const opening = monthStart(today());
  const newStart = addMonths(opening, -1);

  // um lançamento já feito no app, de mesmo valor que a linha de 28/mês passado (R$ 2.000,00), para "trocar match"
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill('2.000,00');
  await page.getByLabel('Descrição').fill('Aluguel já lançado');
  await page.getByLabel('Categoria').selectOption({ label: 'Moradia' });
  await page.locator('#date').fill(addDays(opening, 1));
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/lancamentos/);

  // upload: em vez de recusar, mostra o plano e pede confirmação
  await page.goto('/lancamentos/importar');
  await page.getByLabel('Arquivo do extrato (OFX ou CSV)').setInputFiles({
    name: 'NU_setembro.ofx',
    mimeType: 'application/x-ofx',
    buffer: previousMonthFixture(),
  });
  await page.getByRole('button', { name: 'Importar e revisar' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'antes do início do controle' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('4 lançamentos');
  await expect(alert).toContainText('Confere: o saldo do arquivo na virada');
  await expect(alert).toContainText('R$ 0,00'); // saldo inicial novo calculado do arquivo
  await page.screenshot({ path: 'test-results/historico-confirmar.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // confirmar: reenvia o mesmo arquivo (guardado pelo componente) e abre a revisão
  await alert.getByRole('button', { name: 'Recuar o início e importar' }).click();
  await expect(page).toHaveURL(/\/importacoes\//);
  await expect(page.getByText('Extrato da conta', { exact: true })).toBeVisible();
  await expect(page.getByText('4 linhas · 4 a revisar')).toBeVisible();

  // trocar match: a linha de R$ 2.000,00 oferece o lançamento que já existe
  const pix = page.locator('[data-testid=account-line]').filter({ hasText: 'JOAO PROPRIETARIO' });
  await pix.getByText('Conciliar com um lançamento que já existe').click();
  await expect(pix.getByText('Aluguel já lançado')).toBeVisible();

  // ignorar em lote: marca duas linhas (as caixas ficam fora do formulário, ligadas pelo atributo form)
  const lines = page.locator('[data-testid=account-line]');
  await lines.nth(0).getByRole('checkbox').check();
  await lines.nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Ignorar as marcadas' }).click();
  await expect(page.getByText('2 linhas ignoradas.')).toBeVisible();
  await expect(lines).toHaveCount(2);

  // o saldo inicial recuou em Ajustes, com a trilha de auditoria registrada
  await page.goto('/ajustes');
  await expect(page.getByLabel('Em', { exact: true })).toHaveValue(newStart);
  await expect(page.getByLabel('Saldo inicial')).toHaveValue('0,00');
});
