/**
 * Navegação do celular (375px, PLANO-UI U1/U2): barra inferior Início · Lançamentos · (+) · Relatórios · Mais,
 * painel de tipos no (+), tela "Mais" com as outras seções e seletor de mês só nas telas que dependem do mês.
 * Só navega: não cria nem altera dados.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';

test.beforeEach(async ({ page }) => {
  await login(page, e2eEnv.users.eduardo);
});

const bottomNav = (page: Page) => page.getByRole('navigation', { name: 'Navegação principal' });
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

test('barra inferior: Início, Lançamentos, Relatórios e Mais; Cartões fica no Mais', async ({ page }) => {
  const nav = bottomNav(page);
  for (const name of ['Início', 'Lançamentos', 'Relatórios', 'Mais'])
    await expect(nav.getByRole('link', { name })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Cartões' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveAttribute('aria-current', 'page');
});

test('(+) abre o painel de tipos e cada opção abre o formulário no tipo certo', async ({ page }) => {
  await bottomNav(page).getByRole('button', { name: 'Novo lançamento' }).click();
  const sheet = page.getByRole('dialog', { name: 'Novo lançamento' });
  for (const name of [/Despesa/, /Receita/, /Compra no cartão/, /Gasto no benefício/])
    await expect(sheet.getByRole('link', { name })).toBeVisible();

  await sheet.getByRole('link', { name: /Receita/ }).click();
  await expect(page).toHaveURL(/\/lancamentos\/novo\?tipo=receita$/);
  await expect(page.getByRole('radio', { name: 'Receita' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0); // o painel fecha ao escolher

  // já no formulário, trocar de tipo pelo (+) troca o formulário (mesma rota, só muda a URL)
  await bottomNav(page).getByRole('button', { name: 'Novo lançamento' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: /Despesa/ })
    .click();
  await expect(page).toHaveURL(/\/lancamentos\/novo$/);
  await expect(page.getByRole('radio', { name: 'Despesa' })).toHaveAttribute('aria-checked', 'true');
});

test('Mais: leva às outras seções e fica aceso nelas', async ({ page }) => {
  const nav = bottomNav(page);
  const targets: [RegExp, RegExp, string][] = [
    [/Cartões/, /\/cartoes$/, 'Cartões'],
    [/Fixos e recorrentes/, /\/fixos$/, 'Fixos e recorrentes'],
    [/Empréstimos/, /\/emprestimos$/, 'Empréstimos'],
    [/Importar extrato/, /\/lancamentos\/importar$/, 'Importar extrato da conta (OFX ou CSV)'],
    [/Conferir saldo/, /\/conta\/conferencia$/, 'Conferir saldo'],
    [/Ajustes/, /\/ajustes$/, 'Ajustes'],
  ];
  for (const [link, url, heading] of targets) {
    await nav.getByRole('link', { name: 'Mais' }).click();
    await expect(page).toHaveURL(/\/mais$/);
    await page.getByRole('main').getByRole('link', { name: link }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('main').getByText(heading, { exact: true }).first()).toBeVisible();
    // as telas do Mais acendem o Mais (importar não acende Lançamentos)
    await expect(nav.getByRole('link', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Lançamentos' })).not.toHaveAttribute('aria-current', 'page');
  }

  await nav.getByRole('link', { name: 'Mais' }).click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /Benefícios/ })
    .click();
  await expect(page).toHaveURL(/\/cartoes#beneficios$/);
  await expect(page.getByRole('region', { name: 'Cartões de benefícios' })).toBeInViewport();
  await noHorizontalScroll(page);
});

test('seletor de mês só nas telas que dependem do mês, e o mês escolhido segue pelo Mais', async ({
  page,
}) => {
  const monthSelector = page.getByRole('link', { name: 'Mês anterior' });
  for (const path of [
    '/fixos',
    '/emprestimos',
    '/ajustes',
    '/mais',
    '/lancamentos/novo',
    '/relatorios/projecao',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(monthSelector, path).toHaveCount(0);
  }

  await page.goto('/lancamentos');
  await monthSelector.click();
  await expect(page).toHaveURL(/[?&]mes=\d{4}-\d{2}/);
  const mes = new URL(page.url()).searchParams.get('mes');
  await bottomNav(page).getByRole('link', { name: 'Mais' }).click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /Cartões/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/cartoes\\?mes=${mes}$`));
  await expect(monthSelector).toBeVisible();
});
