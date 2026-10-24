/**
 * Cards da Home como atalhos (D68), 375px: cada card abre o detalhe com o MESMO total; a fatura vira uma linha que
 * leva à fatura; e um fixo mensal aparece como despesa prevista no mês seguinte (antes não aparecia).
 */
import { expect, test, type Page } from '@playwright/test';
import { addMonths, monthStart, toMonthParam, today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { login } from './login';

test.describe.configure({ mode: 'serial' });

let page: Page;

const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
const kpi = (slug: string) => page.getByTestId(`kpi-${slug}`);
const next = toMonthParam(addMonths(monthStart(today()), 1));

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

test('cada card da Home abre o detalhe do mês com o mesmo total', async () => {
  // dados dos quatro tipos: receita e despesa pagas, receita e despesa agendadas
  const future = toIso(addDays10());
  for (const [desc, kind, amount, date] of [
    ['Receita paga resumo', 'Receita', '300,00', today()],
    ['Despesa paga resumo', 'Despesa', '45,00', today()],
    ['Receita agendada resumo', 'Receita', '700,00', future],
    ['Despesa agendada resumo', 'Despesa', '80,00', future],
  ] as const) {
    await page.goto('/lancamentos/novo');
    await page.getByRole('radio', { name: kind }).click();
    await page.getByLabel('Valor').fill(amount.replace(',', ''));
    await page.getByLabel('Descrição').fill(desc);
    await page
      .getByLabel('Categoria')
      .selectOption({ label: kind === 'Receita' ? 'Salário CLT' : 'Mercado' });
    await page.locator('#date').fill(date);
    if (desc === 'Despesa paga resumo') await page.getByLabel('Já paguei').check();
    await page.getByRole('button', { name: 'Lançar' }).click();
    await expect(page).toHaveURL(/\/lancamentos/);
  }

  // o agendado cai em outro mês quando faltam menos de 10 dias para o fim do mês: abre o mês certo
  const futureMonth = toMonthParam(monthStart(future));
  const futureQs = futureMonth === toMonthParam(monthStart(today())) ? '' : `?mes=${futureMonth}`;
  for (const [slug, title, expected, qs] of [
    ['entrou', 'Entrou', 'Receita paga resumo', ''],
    ['saiu', 'Saiu', 'Despesa paga resumo', ''],
    ['a-receber', 'A receber', 'Receita agendada resumo', futureQs],
    ['a-pagar', 'A pagar', 'Despesa agendada resumo', futureQs],
  ] as const) {
    await page.goto(`/${qs}`);
    const cardText = (await kpi(slug).innerText()).replace(/\s+/g, ' ');
    const cardAmount = /R\$\s[\d.]+,\d{2}/.exec(cardText)![0];
    await kpi(slug).click();
    await expect(page).toHaveURL(new RegExp(`/resumo/${slug}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
    await expect(page.getByTestId('detail-total')).toContainText(cardAmount); // o mesmo valor do card
    await expect(page.getByText(expected).first()).toBeVisible();
    await noHorizontalScroll();
  }
});

test('o detalhe do mês seguinte mostra o fixo mensal como despesa prevista, que leva ao fixo', async () => {
  await page.goto('/fixos/novo');
  await page.getByLabel('Descrição').fill('Internet resumo');
  await page.getByLabel('Valor').fill('9990');
  await page.getByLabel('Dia do vencimento').fill('15');
  await page.getByLabel('Categoria').selectOption({ label: 'Contas da casa' });
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Histórico', { exact: true })).toBeVisible();

  // mês seguinte na Home: o fixo conta em "A pagar" (antes ficava de fora)
  await page.goto(`/?mes=${next}`);
  const cardText = (await kpi('a-pagar').innerText()).replace(/\s+/g, ' ');
  expect(cardText).not.toContain('R$ 0,00');
  await kpi('a-pagar').click();
  await expect(page).toHaveURL(new RegExp(`/resumo/a-pagar\\?mes=${next}$`));
  const line = page.getByTestId('projected-line').filter({ hasText: 'Internet resumo' });
  await expect(line).toContainText('Previsto');
  await expect(line).toContainText('99,90');
  await expect(page.getByTestId('detail-total')).toContainText(/R\$\s[\d.]+,\d{2}/);
  await noHorizontalScroll();

  await line.click();
  await expect(page).toHaveURL(/\/fixos\/[0-9a-f-]{36}/);
});

test('a fatura que ainda falta pagar é uma linha só e leva para a fatura detalhada', async () => {
  await page.goto('/cartoes/novo');
  await page.getByLabel('Nome').fill('Cartão Resumo');
  await page.getByLabel('Dia do vencimento').fill('20');
  await page.getByLabel('Limite').fill('300000');
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();
  await expect(page).toHaveURL(/\/cartoes\/[0-9a-f-]{36}$/);

  await page.goto('/lancamentos/novo?tipo=cartao');
  await page.getByLabel('Cartão', { exact: true }).selectOption({ label: 'Cartão Resumo' });
  await page.getByLabel('Valor total da compra').fill('12000');
  await page.getByLabel('Descrição').fill('Compra do resumo');
  await page.getByLabel('Categoria').selectOption({ label: 'Mercado' });
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/cartoes\/faturas\//);

  // a fatura vence neste mês ou no próximo, conforme o dia de hoje: procura nos dois
  let found = false;
  for (const mes of ['', `?mes=${next}`]) {
    await page.goto(`/resumo/a-pagar${mes}`);
    const line = page.getByTestId('invoice-line').filter({ hasText: 'Cartão Resumo' });
    if ((await line.count()) > 0) {
      await expect(line).toHaveCount(1); // uma linha por fatura
      await expect(line).toContainText('120,00');
      await line.click();
      await expect(page).toHaveURL(/\/cartoes\/faturas\/[0-9a-f-]{36}/);
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
});

test('mês passado: sem previsão; o detalhe abre vazio sem quebrar', async () => {
  const prev = toMonthParam(addMonths(monthStart(today()), -2));
  await page.goto(`/resumo/a-pagar?mes=${prev}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A pagar');
  await expect(page.getByTestId('projected-line')).toHaveCount(0);
  await noHorizontalScroll();
});

function addDays10(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d;
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
