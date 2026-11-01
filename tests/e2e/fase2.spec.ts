/**
 * Fase 2 no navegador, em tela de celular (375px): login, lançar, fixo, baixa em 2 toques
 * a partir da Home, estornar baixa, conferência de saldo, validação em pt-BR e visão do outro usuário.
 * Os testes são sequenciais e compartilham o banco finah_e2e (recriado a cada execução).
 */
import { expect, test, type Page } from '@playwright/test';
import { today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { homePending } from './home';
import { login as loginWith2fa } from './login';

test.describe.configure({ mode: 'serial' });

const { eduardo, viviane } = e2eEnv.users;
const brl = (s: string) => new RegExp(`R\\$\\s${s.replace('.', '\\.')}`);

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await loginWith2fa(page, user, { goto: false });
}

const balanceCard = (page: Page) => page.locator('[data-slot=card]').filter({ hasText: 'Saldo atual' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, eduardo);
});

test.afterAll(async () => {
  await page.close();
});

test('Home mostra o saldo inicial', async () => {
  await expect(balanceCard(page)).toContainText(brl('1.000,00'));
});

test('lançar uma despesa pelo botão + e ver no extrato e no saldo', async () => {
  // o + abre o painel de tipos (U2); Despesa leva ao formulário
  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: /Despesa/ })
    .click();
  await expect(page).toHaveURL(/\/lancamentos\/novo$/);
  await expect(page.getByRole('heading', { name: 'Novo lançamento', level: 1 })).toBeVisible();
  await page.getByLabel('Valor').fill('123,45');
  await page.getByLabel('Descrição').fill('Padaria');
  await page.getByLabel('Categoria').selectOption({ label: 'Mercado' });
  await page.getByLabel('Já paguei').check(); // sem a chave a despesa fica a pagar (D69)
  await page.getByRole('button', { name: 'Lançar' }).click();

  await expect(page).toHaveURL(/\/lancamentos/);
  const row = page.getByRole('link', { name: /Padaria/ });
  await expect(row).toContainText(brl('123,45'));
  await expect(row).toContainText('Mercado');

  await page.getByRole('link', { name: 'Início' }).click();
  await expect(balanceCard(page)).toContainText(brl('876,55'));
});

test('máscara de valor: digita só os números e os centavos entram primeiro', async () => {
  await page.goto('/lancamentos/novo');
  const valor = page.getByLabel('Valor');
  await valor.pressSequentially('1');
  await expect(valor).toHaveValue('0,01');
  await valor.pressSequentially('2345');
  await expect(valor).toHaveValue('123,45');
  await valor.pressSequentially('600');
  await expect(valor).toHaveValue('123.456,00');
  await valor.press('Backspace');
  await expect(valor).toHaveValue('12.345,60');
  await valor.fill('');
  await expect(valor).toHaveValue('');
  await valor.fill('5.000,00'); // colar/preencher o valor já formatado continua valendo
  await expect(valor).toHaveValue('5.000,00');
});

test('cadastrar um fixo gera a conta do mês como pendente', async () => {
  const day = Number(today().slice(8));
  await page.goto('/fixos/novo');
  await page.getByLabel('Descrição').fill('Internet');
  await page.getByLabel('Valor').fill('99,90');
  await page.getByLabel('Dia do vencimento').fill(String(day));
  await page.getByLabel('Categoria').selectOption({ label: 'Contas da casa' });
  await page.getByRole('button', { name: 'Cadastrar' }).click();

  await expect(page.getByText('Histórico', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Internet/ })).toContainText('Pendente');
});

test('baixa em 2 toques a partir da Home, com valor real', async () => {
  await page.getByRole('link', { name: 'Início' }).click();
  const pending = await homePending(page, 'Internet');
  await expect(pending).toContainText('Vence hoje');

  await pending.getByRole('button', { name: 'Paguei' }).click(); // toque 1
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Valor pago')).toHaveValue('99,90');
  await dialog.getByLabel('Valor pago').fill('105,00');
  await dialog.getByRole('button', { name: 'Confirmar' }).click(); // toque 2

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: 'Internet' })).toHaveCount(0);
  await expect(balanceCard(page)).toContainText(brl('771,55'));
});

test('estornar a baixa volta a pendente com o valor estimado', async () => {
  await page.goto('/lancamentos');
  await page.getByRole('link', { name: /Internet/ }).click();
  await expect(page.getByText('Estimado')).toBeVisible();
  await page.getByRole('button', { name: 'Estornar baixa' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Estornar' }).click();
  await expect(page.getByText('Pendente', { exact: true }).first()).toBeVisible();

  await page.goto('/');
  await expect(balanceCard(page)).toContainText(brl('876,55'));
  await expect(await homePending(page, 'Internet')).toContainText(brl('99,90'));
});

test('conferência de saldo lança o ajuste exato', async () => {
  await balanceCard(page).getByRole('link', { name: 'Conferir' }).click();
  await page.getByLabel('Saldo no banco').fill('870,00');
  await page.getByRole('button', { name: 'Ver saldo do app nessa data' }).click();
  await expect(page.getByText(/Saldo do app em/)).toBeVisible();
  await expect(page.locator('form')).toContainText(brl('876,55'));
  await page.getByRole('button', { name: 'Registrar e ajustar se precisar' }).click();
  await expect(page.getByText('Conferência registrada.')).toBeVisible();
  await expect(page.getByText(/Lançamos um ajuste de/)).toContainText(brl('6,55'));

  await page.goto('/');
  await expect(balanceCard(page)).toContainText(brl('870,00'));
});

test('filtro do extrato por pendentes', async () => {
  await page.goto('/lancamentos?status=PENDING');
  await expect(page.getByRole('link', { name: /Internet/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Padaria/ })).toHaveCount(0);
});

test('a Viviane vê os lançamentos do Eduardo, com quem lançou', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'pt-BR' });
  const p2 = await ctx.newPage();
  await login(p2, viviane);
  await expect(balanceCard(p2)).toContainText(brl('870,00'));
  await p2.goto('/lancamentos');
  await expect(p2.getByRole('link', { name: /Padaria/ }).getByLabel('Lançado por Eduardo')).toBeVisible();
  await ctx.close();
});
