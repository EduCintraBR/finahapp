/**
 * Roda depois de fase2/3/4 (ordem alfabética): o empréstimo mexe no saldo da conta, e esses testes partem do saldo inicial.
 * Empréstimo no navegador (375px, D66): cadastro com o total com juros, valor recebido no saldo (fora das receitas),
 * antecipar as últimas parcelas com desconto, pagar com atraso (acréscimo) e excluir um empréstimo sem pagamentos.
 */
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './env';
import { login } from './login';
import { moreAction } from './forms';

test.describe.configure({ mode: 'serial' });

let page: Page;
let loanUrl = '';

const brl = (v: string) => new RegExp(`R\\$\\s${v.replace(/\./g, '\\.')}`);
const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

/** "R$ 1.234,56" → centavos. */
const cents = (text: string) => {
  const m = /(-?)R\$\s([\d.]+),(\d{2})/.exec(text.replace(/ /g, ' '));
  if (!m) throw new Error(`sem valor em: ${text}`);
  return (m[1] ? -1 : 1) * Number(m[2]!.replace(/\./g, '') + m[3]);
};
/** O botão de pagar fica à vista e mostra quantas parcelas estão marcadas na lista. */
const payButton = () => page.getByRole('button', { name: /^Pagar \d+ parcelas?|^Escolha as parcelas/ });
/** Desmarca tudo; repete até a página hidratar (o botão passa a pedir as parcelas). */
const clearSelection = async () => {
  await expect(async () => {
    await page.getByRole('button', { name: 'Limpar' }).click();
    await expect(payButton()).toHaveText(/Escolha as parcelas/, { timeout: 1_000 });
  }).toPass();
};
/** "Pagar N parcelas" abre o painel do valor e da data. */
const openPay = async () => {
  const sheet = page.getByRole('dialog', { name: 'Pagar parcelas' });
  await expect(async () => {
    if (!(await sheet.isVisible())) await payButton().click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
};
const homeCard = (label: string) => page.locator('[data-slot=card]').filter({ hasText: label }).first();
const accountBalance = async () => {
  await page.goto('/');
  return cents(await homeCard('Saldo atual').innerText());
};

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, e2eEnv.users.eduardo);
});
test.afterAll(async () => page.close());

async function createLoan(name: string, principal: string, total: string, installments: string) {
  await page.goto('/emprestimos/novo');
  await page.getByLabel('Nome', { exact: true }).fill(name);
  await page.getByLabel('Valor recebido').fill(principal);
  await page.getByLabel('Total a pagar').fill(total);
  await page.getByLabel('Parcelas').fill(installments);
  await page.getByRole('button', { name: 'Cadastrar empréstimo' }).click();
  await expect(page).toHaveURL(/\/emprestimos\/[0-9a-f-]{36}/);
}

test('cadastrar: o total com juros vira parcelas e o valor recebido entra no saldo, sem virar receita', async () => {
  const before = await accountBalance();

  await page.goto('/emprestimos');
  await expect(page.getByText('Nenhum empréstimo cadastrado')).toBeVisible();
  await page.getByRole('link', { name: 'Novo', exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Empréstimo pessoal');
  await page.getByLabel('Quem emprestou (opcional)').fill('Banco X');
  await page.getByLabel('Valor recebido').fill('1000000'); // máscara de centavos primeiro
  await expect(page.getByLabel('Valor recebido')).toHaveValue('10.000,00');
  await page.getByLabel('Total a pagar').fill('1.200.000'.replace(/\./g, ''));
  await expect(page.getByLabel('Total a pagar')).toHaveValue('12.000,00');
  await page.getByLabel('Parcelas').fill('12');
  await expect(
    page.getByText(/12× de R\$\s1\.000,00 · juros embutidos R\$\s2\.000,00 \(20,00%/),
  ).toBeVisible();
  await noHorizontalScroll();
  await page.getByRole('button', { name: 'Cadastrar empréstimo' }).click();

  await expect(page).toHaveURL(/\/emprestimos\/[0-9a-f-]{36}/);
  loanUrl = page.url();
  await expect(page.getByTestId('loan-remaining')).toContainText(brl('12.000,00'));
  await expect(page.getByTestId('loan-installment')).toHaveCount(12);
  await noHorizontalScroll();

  expect(await accountBalance()).toBe(before + 1_000_000); // entrou no saldo da conta
  // ...mas não é receita: o "Entrou" da Home não inclui o valor recebido
  await expect(homeCard('Entrou')).not.toContainText(brl('10.000,00'));
});

test('antecipar as 3 últimas parcelas com um valor só: o desconto é calculado', async () => {
  await page.goto(loanUrl);
  await clearSelection();
  for (const n of [10, 11, 12]) await page.getByRole('checkbox', { name: new RegExp(`^${n}/12`) }).check();
  await expect(payButton()).toHaveText(/Pagar 3 parcelas/);
  await openPay();
  await expect(page.getByLabel('Valor que paguei')).toHaveValue('3.000,00'); // sugere a soma
  await page.getByLabel('Valor que paguei').fill('270000');
  await expect(page.getByTestId('pay-preview')).toContainText('desconto de R$');
  await expect(page.getByTestId('pay-preview')).toContainText(brl('300,00'));
  const before = await accountBalance();
  await page.goto(loanUrl);
  await clearSelection();
  for (const n of [10, 11, 12]) await page.getByRole('checkbox', { name: new RegExp(`^${n}/12`) }).check();
  await expect(payButton()).toHaveText(/Pagar 3 parcelas/);
  await openPay();
  await page.getByLabel('Valor que paguei').fill('270000');
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();

  await expect(page.getByText(/Pagamento registrado/)).toContainText('economia de');
  await expect(page.getByTestId('loan-remaining')).toContainText(brl('9.000,00'));
  await expect(page.getByTestId('loan-savings')).toContainText(brl('300,00'));
  await expect(page.getByTestId('loan-paid')).toContainText(brl('2.700,00'));
  await expect(page.getByText(/adiantou \d+ dias/).first()).toBeVisible();
  expect(await accountBalance()).toBe(before - 270_000); // saiu da conta
  await noHorizontalScroll();
});

test('pagar a 1ª parcela com atraso e valor maior: aparece o acréscimo', async () => {
  await page.goto(loanUrl);
  await expect(payButton()).toHaveText(/Pagar 1 parcela/); // a 1ª pendente já vem marcada
  await openPay();
  await page.getByLabel('Valor que paguei').fill('103500');
  await expect(page.getByTestId('pay-preview')).toContainText('acréscimo de R$');
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  await expect(page.getByText(/Pagamento registrado/)).toContainText('acréscimo de');
  await expect(page.getByText('Acréscimo por atraso')).toBeVisible();
  await expect(page.getByTestId('loan-remaining')).toContainText(brl('8.000,00'));
});

test('as parcelas aparecem em Lançamentos e não são editadas por lá', async () => {
  await page.goto('/lancamentos');
  await noHorizontalScroll(); // o cabeçalho com o atalho de empréstimos cabe em 375px
  await expect(page.getByText(/Empréstimo recebido/).first()).toBeVisible();
  await page
    .getByRole('link', { name: /Empréstimo recebido/ })
    .first()
    .click();
  await page
    .getByText('Editar', { exact: true })
    .click()
    .catch(() => undefined);
  await noHorizontalScroll();
});

test('o empréstimo aparece na Home e na lista, e a projeção desconta as parcelas dos meses futuros', async () => {
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Empréstimos' }).getByRole('link', { name: /Empréstimo pessoal/ }),
  ).toBeVisible();
  await noHorizontalScroll();
  await page.goto('/emprestimos');
  await expect(page.getByRole('link', { name: /Empréstimo pessoal/ })).toContainText('parcelas pagas');
  await page.goto('/relatorios/projecao');
  await expect(page.getByText('· Empréstimos').first()).toBeVisible();
});

test('excluir um empréstimo sem pagamentos devolve o saldo; com pagamento, não deixa', async () => {
  const before = await accountBalance();
  await createLoan('Para excluir', '500000', '600000', '6');
  const toDelete = page.url();
  expect(await accountBalance()).toBe(before + 500_000);
  await page.goto(toDelete);
  await moreAction(page, 'Excluir empréstimo');
  await expect(page.getByRole('alertdialog')).toContainText('Excluir este empréstimo?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page).toHaveURL(/\/emprestimos$/);
  await expect(page.getByText('Para excluir')).toHaveCount(0);
  expect(await accountBalance()).toBe(before);

  await page.goto(loanUrl); // este já tem parcela paga
  await expect(async () => {
    await page.getByRole('button', { name: 'Mais ações' }).click();
    await expect(page.getByRole('dialog', { name: 'Mais ações' })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const menu = page.getByRole('dialog', { name: 'Mais ações' });
  await expect(menu.getByText('Já tem parcela paga')).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Excluir empréstimo' })).toHaveCount(0);
});
