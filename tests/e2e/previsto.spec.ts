/**
 * Previsto dia a dia (D94), 375px: o "Previsto no fim do mês" da Início abre o detalhe com o MESMO número, a
 * composição, o dia a dia (a conta de hoje aparece no dia de hoje), o mês seguinte encadeado e a simulação de
 * compra no cartão (que não grava nada).
 */
import { expect, test, type Page } from '@playwright/test';
import { addMonths, monthStart, toMonthParam, today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { pickCategory } from './forms';
import { login } from './login';

test.describe.configure({ mode: 'serial' });

let page: Page;

const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
const money = (text: string) => /−?R\$\s[\d.]+,\d{2}/.exec(text.replace(/\s+/g, ' '))![0];
const next = toMonthParam(addMonths(monthStart(today()), 1));

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('o previsto da Início abre o detalhe com o mesmo número e a conta de hoje no dia de hoje', async () => {
  await page.goto('/lancamentos/novo');
  await page.getByRole('radio', { name: 'Despesa' }).click();
  await page.getByLabel('Valor').fill('4321');
  await page.getByLabel('Descrição').fill('Conta do previsto');
  await pickCategory(page, 'Mercado');
  await page.locator('#date').fill(today()); // sem "Já paguei": fica a pagar, vencendo hoje
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/lancamentos/);

  await page.goto('/');
  const line = page.getByTestId('end-of-month');
  const homeValue = money(await line.innerText());
  await line.click();
  await expect(page).toHaveURL(/\/resumo\/previsto$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Previsto no fim do mês');
  await expect(page.getByTestId('forecast-total')).toContainText(homeValue);

  const equation = page.getByTestId('forecast-equation');
  await expect(equation).toContainText('Como chegamos nesse número');
  await expect(equation).toContainText('Saldo hoje');
  await expect(equation).toContainText('Contas a pagar');

  const todayBlock = page.locator(`[data-testid="forecast-day"][data-date="${today()}"]`);
  await expect(todayBlock).toContainText('Hoje');
  const flow = todayBlock.getByTestId('forecast-flow').filter({ hasText: 'Conta do previsto' });
  await expect(flow).toContainText('A pagar');
  await expect(flow).toContainText('43,21');
  await expect(page.getByRole('img', { name: /saldo da conta em cada dia/ })).toBeVisible();
  await noHorizontalScroll();
});

test('o mês seguinte começa no previsto deste e bate com a Início daquele mês', async () => {
  await page.goto(`/?mes=${next}`);
  const homeValue = money(await page.getByTestId('balance-main').innerText());
  await page.getByTestId('end-of-month').click();
  await expect(page).toHaveURL(new RegExp(`/resumo/previsto\\?mes=${next}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Estimado no fim do mês');
  await expect(page.getByTestId('forecast-total')).toContainText(homeValue);

  // a composição parte do estimado do fim do mês atual, que é o total da tela do mês atual
  await page.goto('/resumo/previsto');
  const currentEnd = money(await page.getByTestId('forecast-total').innerText());
  await page.goto(`/resumo/previsto?mes=${next}`);
  await expect(page.getByTestId('forecast-equation')).toContainText(currentEnd);
  await noHorizontalScroll();
});

test('posso gastar no cartão: folga por cartão e simulação sem gravar nada', async () => {
  await page.goto('/cartoes/novo');
  await page.getByLabel('Nome').fill('Cartão Previsto');
  await page.getByLabel('Dia do vencimento').fill('20');
  await page.getByLabel('Limite').fill('500000');
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();
  await expect(page).toHaveURL(/\/cartoes\/[0-9a-f-]{36}$/);

  await page.goto('/resumo/previsto');
  const room = page.getByTestId('card-room').filter({ hasText: 'Cartão Previsto' });
  await expect(room).toContainText('Compra hoje cai na fatura de');
  await expect(room).toContainText('À vista, até');

  await expect(async () => {
    await page.getByLabel('Cartão', { exact: true }).selectOption({ label: 'Cartão Previsto' });
    await page.getByLabel('Valor').fill('120000');
    await page.getByLabel('Parcelas').selectOption({ label: '3x' });
    await expect(page.getByTestId('simulation-result')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const result = page.getByTestId('simulation-result');
  await expect(result).toContainText('(1/3)');
  await expect(result).toContainText('400,00');
  await expect(result).toContainText(/continua positiva|fica negativa/);
  await noHorizontalScroll();

  // nada foi gravado: o cartão continua sem compras
  await page.goto('/cartoes');
  await expect(page.getByText('Cartão Previsto').first()).toBeVisible();
  await page.goto('/lancamentos');
  await expect(page.getByText(/Simulação/)).toHaveCount(0);
});
