/**
 * Ajustes de usabilidade (21/10/2026), no navegador (375px): tema claro/escuro, cartão pré-selecionado em
 * "Nova compra", volta para a lista do mês depois de lançar e seletor de mês nas telas de cartão.
 * Roda depois dos testes de importação (precisa de cartões e faturas já criados) e cria o que mais precisar.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  addDays,
  addMonths,
  formatMonthLabel,
  monthStart,
  toMonthParam,
  today,
} from '../../src/domain/dates';
import { e2eEnv } from './env';
import { login } from './login';
import { moreAction, pickCategory } from './forms';

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
});

const theme = (page: Page) => page.locator('html').getAttribute('data-theme');
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

test('tema: padrão escuro, alterna pelo botão do cabeçalho, escolha completa em Ajustes e persiste', async ({
  page,
}) => {
  expect(await theme(page)).toBe('dark');
  await expect(page.getByRole('link', { name: 'Mês anterior' })).toBeVisible(); // o cabeçalho cabe em 375px
  await noHorizontalScroll(page);

  await page.getByRole('button', { name: 'Mudar para o tema claro' }).click();
  await expect.poll(() => theme(page)).toBe('light');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgb(15, 18, 19)');

  await page.reload();
  expect(await theme(page)).toBe('light'); // guardado neste aparelho
  await expect(page.getByRole('button', { name: 'Mudar para o tema escuro' })).toBeVisible();

  await page.goto('/ajustes');
  const group = page.getByRole('radiogroup', { name: 'Tema' });
  await expect(group.getByRole('radio', { name: 'Claro' })).toHaveAttribute('aria-checked', 'true');
  await group.getByRole('radio', { name: 'Escuro' }).click();
  await expect.poll(() => theme(page)).toBe('dark');
  await group.getByRole('radio', { name: 'Sistema' }).click();
  await expect(group.getByRole('radio', { name: 'Sistema' })).toHaveAttribute('aria-checked', 'true');
  await group.getByRole('radio', { name: 'Escuro' }).click(); // deixa como o padrão
  await page.reload();
  expect(await theme(page)).toBe('dark');
  await noHorizontalScroll(page);
});

test('Nova compra dentro de um cartão já vem com esse cartão selecionado (não o primeiro)', async ({
  page,
}) => {
  await page.goto('/cartoes/novo');
  await page.getByLabel('Nome').fill('Segundo Cartão');
  await page.getByLabel('Dia do vencimento').fill('12');
  await page.getByLabel('Limite').fill('2.000,00');
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();
  await expect(page).toHaveURL(/\/cartoes\/[0-9a-f-]{36}$/);
  const secondId = page.url().split('/').pop()!;

  await page.getByRole('link', { name: 'Nova compra' }).click();
  await expect(page).toHaveURL(new RegExp(`tipo=cartao&cartao=${secondId}`));
  await expect(page.getByLabel('Cartão', { exact: true })).toHaveValue(secondId);
  // sem vir de um cartão, continua sendo o primeiro da lista
  await page.goto('/lancamentos/novo?tipo=cartao');
  await expect(page.getByLabel('Cartão', { exact: true })).not.toHaveValue(secondId);
});

test('depois de lançar na conta, volta para a lista do mês da data (não para os detalhes)', async ({
  page,
}) => {
  const lastDayOfLastMonth = addDays(monthStart(today()), -1);
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill('15,00');
  await page.getByLabel('Descrição').fill('Lançado no mês passado');
  await pickCategory(page, 'Mercado');
  await page.locator('#date').fill(lastDayOfLastMonth);
  await page.getByRole('button', { name: 'Lançar' }).click();

  const month = toMonthParam(monthStart(lastDayOfLastMonth));
  await expect(page).toHaveURL(new RegExp(`/lancamentos\\?mes=${month}$`));
  await expect(page.getByRole('link', { name: /Lançado no mês passado/ })).toBeVisible();

  // no mês atual, a lista fica sem parâmetro
  await page.goto('/lancamentos/novo');
  await page.getByLabel('Valor').fill('7,00');
  await page.getByLabel('Descrição').fill('Lançado hoje');
  await pickCategory(page, 'Mercado');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/lancamentos$/);
  await expect(page.getByRole('link', { name: /Lançado hoje/ })).toBeVisible();
});

test('seletor de mês: Início e Cartões mostram o mês escolhido, com cartão sem fatura zerado e avisado', async ({
  page,
}) => {
  await page.goto('/cartoes');
  await page.getByRole('link', { name: 'Mês anterior' }).click();
  await expect(page).toHaveURL(/[?&]mes=\d{4}-\d{2}/);
  const prev = addMonths(monthStart(today()), -1);
  await expect(page.getByText(`Fatura de ${formatMonthLabel(prev)}`).first()).toBeVisible();

  // um mês longe, sem nenhuma fatura: valor zerado e a mensagem
  const far = addMonths(monthStart(today()), -6);
  await page.goto(`/cartoes?mes=${toMonthParam(far)}`);
  await expect(
    page.getByText(`Nenhuma fatura lançada para ${formatMonthLabel(far)} neste cartão.`).first(),
  ).toBeVisible();
  await expect(page.getByText('Sem fatura').first()).toBeVisible();
  await noHorizontalScroll(page);

  // a tela de um cartão também avisa
  await page.locator('a[href^="/cartoes/"]').filter({ hasText: 'Sem fatura' }).first().click();
  await page.waitForURL(/\/cartoes\/[0-9a-f-]{36}/);
  await expect(
    page.getByText(`Nenhuma fatura lançada para ${formatMonthLabel(far)} neste cartão.`),
  ).toBeVisible();

  // o Início segue o mesmo mês: saldo do fim do mês escolhido e os cartões daquele mês
  await page.goto(`/?mes=${toMonthParam(far)}`);
  await expect(page.getByText(`Saldo no fim de ${formatMonthLabel(far)}`)).toBeVisible();
  await expect(page.getByText('Sem fatura').first()).toBeVisible();
  await noHorizontalScroll(page);
});

test('excluir um fixo: confirma, volta para a lista e o fixo some', async ({ page }) => {
  await page.goto('/fixos/novo');
  await page.getByLabel('Descrição').fill('Fixo para excluir');
  await page.getByLabel('Valor').fill('10,00');
  await page.getByLabel('Dia do vencimento').fill('28');
  await pickCategory(page, 'Contas da casa');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Histórico', { exact: true })).toBeVisible();
  await moreAction(page, 'Excluir fixo');
  await expect(page.getByRole('alertdialog')).toContainText('Excluir este fixo?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();

  await expect(page).toHaveURL(/\/fixos$/);
  await expect(page.getByText('Fixo para excluir')).toHaveCount(0);
});

test('receita com data futura fica agendada: não entra no saldo atual, mostra o aviso e o selo', async ({
  page,
}) => {
  const balanceOf = async () => {
    await page.goto('/');
    // só o saldo: A receber e a previsão do mesmo card mudam com a receita agendada, se ela cair neste mês
    return page.getByTestId('balance-main').innerText();
  };
  const before = await balanceOf();

  const future = addDays(today(), 10);
  await page.goto('/lancamentos/novo');
  await page.getByRole('radio', { name: 'Receita' }).click();
  await page.getByLabel('Valor').fill('50000');
  await page.getByLabel('Descrição').fill('Freela agendado');
  await pickCategory(page, 'Salário CLT');
  await page.locator('#date').fill(future);
  await expect(page.getByText(/Data futura: fica agendado e só entra no saldo em/)).toBeVisible();
  await page.getByRole('button', { name: 'Lançar' }).click();

  await expect(page).toHaveURL(/\/lancamentos/);
  const row = page.getByRole('link', { name: /Freela agendado/ });
  await expect(row).toContainText('Agendado');
  expect(await balanceOf()).toBe(before); // o saldo de hoje não mudou

  // uma receita de hoje, ao contrário, conta na hora
  await page.goto('/lancamentos/novo');
  await page.getByRole('radio', { name: 'Receita' }).click();
  await page.getByLabel('Valor').fill('10000');
  await page.getByLabel('Descrição').fill('Receita de hoje');
  await pickCategory(page, 'Salário CLT');
  await expect(page.getByText(/Data futura/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('link', { name: /Receita de hoje/ })).not.toContainText('Agendado');
  expect(await balanceOf()).not.toBe(before);
});
