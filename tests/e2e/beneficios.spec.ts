/**
 * Cartão de benefícios no navegador (375px, D65): cadastro com duas carteiras, gasto que sai do saldo da carteira
 * (e não da conta), saldo insuficiente, edição pelo histórico (D78), filtro por carteira, exclusão que devolve o
 * valor e encerramento sem perder o histórico.
 * Os créditos automáticos (último dia útil) são cobertos nos testes de aceitação, que controlam a data.
 */
import { expect, test, type Page } from '@playwright/test';
import { lastBusinessDay } from '../../src/domain/benefits/credits';
import { addMonths, compareDates, monthStart, toMonthParam, today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { login } from './login';
import { pickCategory } from './forms';

test.describe.configure({ mode: 'serial' });

let page: Page;
let cardUrl = '';

const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
const saldo = (name: string) => page.getByTestId(`saldo-${name}`);
const brl = (v: string) => new RegExp(`R\\$\\s${v.replace(/\./g, '\\.')}`);
/** O saldo da conta na Home, para provar que o cartão de benefícios não mexe nele. */
const accountBalance = async () => {
  await page.goto('/');
  return page.locator('[data-slot=card]').filter({ hasText: 'Saldo atual' }).first().innerText();
};

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('cadastrar o cartão com Multibenefícios e Refeição, cada carteira com crédito mensal e saldo de hoje', async () => {
  const before = await accountBalance();
  await page.goto('/cartoes');
  await page.getByRole('link', { name: 'Benefício', exact: true }).click();
  await expect(page).toHaveURL(/\/beneficios\/novo/);
  await page.getByLabel('Nome do cartão').fill('Multibenefícios Empresa');
  await page.getByLabel('Emissor (opcional)').fill('Empresa');

  await page.locator('#w0credit').fill('1500');
  await page.locator('#w0opening').fill('80000');
  await expect(page.locator('#w0credit')).toHaveValue('15,00'); // máscara de centavos primeiro
  await page.locator('#w0credit').fill('1.500,00');
  await page.locator('#w0opening').fill('800,00');
  await expect(page.locator('#w1name')).toHaveValue('Refeição e alimentação');
  await page.locator('#w1credit').fill('704,00');
  await page.locator('#w1opening').fill('100,00');
  await noHorizontalScroll();
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();

  await expect(page).toHaveURL(/\/beneficios\/[0-9a-f-]{36}/);
  cardUrl = page.url();
  await expect(saldo('Multibenefícios')).toContainText(brl('800,00'));
  await expect(saldo('Refeição e alimentação')).toContainText(brl('100,00'));
  await expect(page.getByText('Próximo crédito').or(page.getByText(/próximo em/))).toBeVisible();
  expect(await accountBalance()).toBe(before); // o dinheiro do benefício não passa pela conta
});

test('gasto no benefício: sai do saldo da carteira, volta para o cartão e não mexe na conta', async () => {
  const before = await accountBalance();
  await page.goto(cardUrl);
  await page
    .locator('[data-slot=card]')
    .filter({ hasText: 'Refeição e alimentação' })
    .getByRole('link', { name: /Novo gasto/ })
    .click();
  await expect(page.getByRole('radio', { name: 'Benefício' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Carteira')).toContainText('Refeição e alimentação');
  await page.getByLabel('Valor').fill('25,00');
  await page.getByLabel('Descrição').fill('Almoço no restaurante');
  await pickCategory(page, 'Alimentação fora');
  await page.getByRole('button', { name: 'Lançar' }).click();

  await expect(page).toHaveURL(cardUrl); // volta para o cartão, não para os detalhes (D59)
  await expect(saldo('Refeição e alimentação')).toContainText(brl('75,00'));
  await expect(page.getByText('Almoço no restaurante')).toBeVisible();
  expect(await accountBalance()).toBe(before);
});

test('o gasto entra nos relatórios, filtrável por "Cartão de benefícios"', async () => {
  await page.goto('/relatorios?meio=BENEFIT_CARD');
  await expect(page.getByTestId('report-total')).toContainText(brl('25,00'));
  await page.goto('/relatorios?meio=PIX');
  await expect(page.getByTestId('report-total')).not.toContainText(brl('25,00'));
});

test('sem saldo suficiente na carteira, não lança', async () => {
  await page.goto(`/lancamentos/novo?tipo=beneficio`);
  const wallet = await page
    .getByLabel('Carteira')
    .locator('option', { hasText: 'Refeição e alimentação' })
    .getAttribute('value');
  await page.getByLabel('Carteira').selectOption(wallet!);
  await page.getByLabel('Valor').fill('5.000,00');
  await page.getByLabel('Descrição').fill('Compra grande');
  await pickCategory(page, 'Alimentação fora');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Saldo insuficiente' })).toBeVisible();
  await expect(page).toHaveURL(/\/lancamentos\/novo/);
});

test('editar o gasto pelo histórico: o novo valor sai da carteira e volta para o cartão (D78)', async () => {
  await page.goto(cardUrl);
  await page.getByRole('link', { name: /Almoço no restaurante/ }).click();
  await expect(page).toHaveURL(/\/lancamentos\/[0-9a-f-]{36}/);
  await expect(page.getByText('Refeição e alimentação').first()).toBeVisible();
  // "Editar" abre um painel; repete o toque até a página hidratar
  const sheet = page.getByRole('dialog', { name: 'Editar lançamento' });
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(sheet.getByLabel('Carteira')).toContainText('Refeição e alimentação');
  await sheet.getByLabel('Valor').fill('30,00');
  await noHorizontalScroll();
  await sheet.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(page).toHaveURL(cardUrl);
  await expect(saldo('Refeição e alimentação')).toContainText(brl('70,00'));
});

test('o histórico filtra por carteira', async () => {
  await page.goto(cardUrl);
  const filtro = page.getByRole('navigation', { name: 'Carteira' });
  await filtro.getByRole('link', { name: 'Refeição e alimentação' }).click();
  await expect(page).toHaveURL(/carteira=/);
  await expect(filtro.getByRole('link', { name: 'Refeição e alimentação' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.getByText('Almoço no restaurante')).toBeVisible();
  await expect(page.getByText('Saldo inicial · Multibenefícios')).toHaveCount(0);
  await noHorizontalScroll();

  await filtro.getByRole('link', { name: 'Multibenefícios' }).click();
  await expect(page.getByText('Saldo inicial · Multibenefícios')).toBeVisible();
  await expect(page.getByText('Almoço no restaurante')).toHaveCount(0);

  await filtro.getByRole('link', { name: 'Todas' }).click();
  await expect(page.getByText('Almoço no restaurante')).toBeVisible();
  await expect(page.getByText('Saldo inicial · Multibenefícios')).toBeVisible();
});

test('excluir o gasto devolve o valor para a carteira', async () => {
  await page.goto(cardUrl);
  await page
    .locator('div')
    .filter({ hasText: /^Almoço no restaurante/ })
    .getByRole('button', { name: 'Excluir' })
    .first()
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(saldo('Refeição e alimentação')).toContainText(brl('100,00'));
  await expect(page.getByText('Almoço no restaurante')).toHaveCount(0);
});

test('o cartão aparece em Cartões e na Home', async () => {
  await page.goto('/cartoes');
  await expect(page.getByRole('link', { name: /Multibenefícios Empresa/ })).toContainText('Ativo');
  await noHorizontalScroll();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Multibenefícios Empresa/ })).toBeVisible();
  await noHorizontalScroll();
});

test('encerrar: para os créditos, mantém o histórico e o saldo', async () => {
  await page.goto(cardUrl);
  // o cartão do teste começa no primeiro mês cujo crédito ainda não caiu: encerra nesse mesmo mês
  let first = monthStart(today());
  while (compareDates(lastBusinessDay(first), today()) <= 0) first = addMonths(first, 1);
  // "Encerrar" abre um painel; repete o toque até a página hidratar
  const sheet = page.getByRole('dialog', { name: 'Encerrar cartão' });
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.getByRole('button', { name: 'Encerrar', exact: true }).click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await sheet.getByLabel('Último mês com crédito').selectOption(toMonthParam(first));
  await sheet.getByRole('button', { name: 'Encerrar cartão' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(/Encerra em|Encerrado/).first()).toBeVisible();
  await expect(saldo('Multibenefícios')).toContainText(brl('800,00'));
  await expect(page.getByRole('button', { name: 'Encerrar cartão' })).toHaveCount(0);
});
