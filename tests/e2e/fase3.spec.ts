/**
 * Fase 3 no navegador (375px): cartão, compra parcelada, fatura, pagamento, antecipação,
 * estorno total, assinatura no cartão e parcelamento em andamento. O limite disponível é
 * conferido a cada passo (fórmula canônica). Datas relativas a "hoje" (fechamento dia 3).
 */
import { expect, test, type Page } from '@playwright/test';
import { today } from '../../src/domain/dates';
import { e2eEnv } from './env';
import { login } from './login';
import { pickCategory } from './forms';

test.describe.configure({ mode: 'serial' });

const brl = (s: string) => new RegExp(`R\\$\\s${s.replace(/\./g, '\\.')}`);
let page: Page;
let cardUrl = '';
let planUrl = '';

const available = (p: Page) => p.getByText(/^Disponível/).first();

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});

test.afterAll(async () => page.close());

test('cadastrar cartão: fechamento sugerido = vencimento − 7', async () => {
  await page.goto('/cartoes/novo');
  await page.getByLabel('Nome').fill('Nubank Teste');
  await page.getByLabel('Dia do vencimento').fill('10');
  await expect(page.getByLabel('Dia do fechamento')).toHaveValue('3');
  await page.getByLabel('Limite').fill('5.000,00');
  await page.getByRole('button', { name: 'Cadastrar cartão' }).click();
  await expect(
    page.getByRole('heading', { name: 'Nubank Teste' }).or(page.getByText('Nubank Teste').first()),
  ).toBeVisible();
  cardUrl = page.url();
  await expect(available(page)).toContainText(brl('5.000,00'));
});

test('compra parcelada em 3x pelo botão +, resto do arredondamento na 1ª', async () => {
  await page.goto('/lancamentos/novo?tipo=cartao');
  await expect(page.getByRole('radio', { name: 'Cartão' })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Valor total da compra').fill('100,00');
  await page.getByLabel('Parcelas').fill('3');
  await expect(page.getByText(/1ª de R\$\s33,34 \+ 2× de R\$\s33,33/)).toBeVisible();
  await page.getByLabel('Descrição').fill('Tênis');
  await pickCategory(page, 'Compras');
  await page.getByRole('button', { name: 'Lançar' }).click();

  // depois de lançar volta para a fatura onde a compra caiu (os detalhes só abrem se você tocar nela)
  await expect(page).toHaveURL(/\/cartoes\/faturas\//);
  await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible(); // itens separados por dia
  await page.getByRole('link', { name: /Tênis/ }).first().click();
  await expect(page).toHaveURL(/\/cartoes\/compras\//);
  planUrl = page.url();
  for (const p of ['1/3', '2/3', '3/3']) await expect(page.getByText(p, { exact: true })).toBeVisible();
  await page.goto(cardUrl);
  await expect(available(page)).toContainText(brl('4.900,00'));
});

test('fatura da 1ª parcela: pagar libera o limite', async () => {
  await page.goto(planUrl);
  await page.getByRole('link', { name: /^1\/3/ }).click();
  await expect(page).toHaveURL(/\/cartoes\/faturas\//);
  await expect(page.getByText('Aberta').first()).toBeVisible();
  await page.getByRole('button', { name: 'Pagar fatura' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Valor pago')).toHaveValue('33,34');
  await dialog.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Pago R\$\s33,34/)).toBeVisible();
  await page.goto(cardUrl);
  await expect(available(page)).toContainText(brl('4.933,34'));
});

test('antecipar a última parcela, paga avulsa com desconto', async () => {
  await page.goto(planUrl);
  await page.getByText('Antecipar parcelas').click();
  await expect(page.getByRole('checkbox', { name: /3\/3/ })).toBeChecked();
  await page.getByLabel('Valor pago').fill('30,00');
  await page.getByRole('radio', { name: 'Pago avulso (Pix)' }).click();
  await page.getByRole('button', { name: 'Antecipar' }).click();
  await expect(page.getByText('Antecipação registrada.')).toBeVisible();
  await page.reload();
  await expect(page.getByText(/economia/)).toContainText(brl('3,33'));
  await page.goto(cardUrl);
  await expect(available(page)).toContainText(brl('4.966,67')); // libera o bruto (33,33)
});

test('cancelar a compra toda (Modo B): o que já foi pago volta como crédito', async () => {
  await page.goto(planUrl);
  await page.getByText('Estorno / devolução').click();
  await page.getByRole('radio', { name: /Cancelar a compra toda/ }).click();
  await page.getByRole('button', { name: 'Cancelar compra' }).click();
  await expect(page.getByText('Cancelada').first()).toBeVisible();
  // o crédito cai na fatura aberta atual (a mesma da 1ª parcela), não numa fatura distante
  const credit = page.getByRole('link', { name: /Estorno Tênis/ });
  await expect(credit).toContainText(brl('30,00'));
  await expect(credit).toContainText(/fatura de novembro|fatura de dezembro/);
  await page.goto(cardUrl);
  // parcelas não cobradas canceladas; crédito = antecipação paga (30,00); pagamento de 33,34 continua valendo
  await expect(available(page)).toContainText(brl('5.063,34'));
  await expect(available(page)).toContainText('crédito na fatura');
});

test('assinatura no cartão vira compra no dia da cobrança', async () => {
  await page.goto('/fixos/novo');
  await page.getByLabel('Descrição').fill('Streaming');
  await page.getByLabel('Valor').fill('55,90');
  await page.getByLabel('Dia do vencimento').fill(String(Number(today().slice(8))));
  await pickCategory(page, 'Assinaturas');
  await page.getByLabel('Meio').selectOption({ label: 'Cartão de crédito' });
  await page.getByLabel('Cartão', { exact: true }).selectOption({ label: 'Nubank Teste' });
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Histórico', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Streaming/ })).toBeVisible();
  await page.goto(cardUrl);
  await expect(available(page)).toContainText(brl('5.007,44'));
});

test('parcelamento em andamento: só as parcelas restantes', async () => {
  await page.goto(`${cardUrl}/em-andamento`);
  await page.getByLabel('Descrição').fill('Geladeira');
  await page.getByLabel('Valor total da compra').fill('1.000,00');
  await page.getByLabel('Data da compra').fill('2026-03-05');
  await page.getByLabel('Parcela atual', { exact: true }).fill('9');
  await page.getByLabel('Total de parcelas').fill('10');
  await pickCategory(page, 'Casa e manutenção');
  await page.getByRole('button', { name: 'Cadastrar parcelamento' }).click();
  await expect(page).toHaveURL(/\/cartoes\/faturas\//);
  await page
    .getByRole('link', { name: /Geladeira/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/cartoes\/compras\//);
  await expect(page.getByText('9/10', { exact: true })).toBeVisible();
  await expect(page.getByText('10/10', { exact: true })).toBeVisible();
  await expect(page.getByText('1/10', { exact: true })).toHaveCount(0);
  await page.goto(cardUrl);
  await expect(available(page)).toContainText(brl('4.807,44'));
});

test('Home mostra o cartão com a fatura atual e o limite', async () => {
  await page.goto('/');
  const card = page.getByRole('link', { name: /^Nubank Teste/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText(brl('4.807,44'));
});

test('compra excluída some da fatura', async () => {
  await page.goto('/lancamentos/novo?tipo=cartao');
  await page.getByLabel('Valor total da compra').fill('12,00');
  await page.getByLabel('Descrição').fill('Lançada errado');
  await pickCategory(page, 'Compras');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page).toHaveURL(/\/cartoes\/faturas\//);
  await expect(page.getByText('Lançada errado')).toBeVisible();
  const invoiceUrl = page.url();
  await page.getByRole('link', { name: /Lançada errado/ }).click();
  await expect(page).toHaveURL(/\/cartoes\/compras\//); // espera a navegação antes de guardar a URL
  const purchaseUrl = page.url();

  await page.goto(purchaseUrl);
  await page.getByText('Editar', { exact: true }).click();
  await page.getByRole('button', { name: 'Excluir compra' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page).toHaveURL(/\/cartoes\/[0-9a-f-]{36}$/);

  await page.goto(invoiceUrl);
  await expect(page.getByText('Lançada errado')).toHaveCount(0);
});
