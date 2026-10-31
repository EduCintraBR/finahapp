/**
 * Capturas de tela de todas as rotas, no celular (375×812) e no desktop (1280×800), para comparar antes e depois
 * de mudanças de UI. Uso: `pnpm ui:shots [nome] [filtro]` → tmp/ui-shots/<nome>/{m,d,i}/*.png
 *
 * Cria do zero o banco SEPARADO `finah_shots` (no Postgres do .env) com dados fictícios de ~3 meses, relativos a hoje,
 * sobe `next dev` na porta 3200 (NEXT_DIST_DIR=.next-shots, ao lado do `pnpm dev`) e derruba no fim.
 * Nunca toca no banco de uso real. Precisa de `docker compose up -d db`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium, devices, type Browser, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createDb, type AnyDB } from '../src/db/client';
import { benefitWallets, categories, invoices, transactions, users } from '../src/db/schema';
import { seed, seedConfigFromEnv } from '../src/db/seed';
import {
  addDays,
  addMonths,
  dateInMonth,
  monthStart,
  toMonthParam,
  today,
  type ISODate,
} from '../src/domain/dates';
import { deriveKey, seal } from '../src/server/auth/secret-box';
import { base32Encode, totpCode, totpStep } from '../src/server/auth/totp';
import { createBenefitCard, createBenefitSpend, generateBenefitCredits } from '../src/server/benefits';
import { createCardPurchase, createOnboardingPlan } from '../src/server/card-purchases';
import { createCard } from '../src/server/cards';
import { confirmPayment, createEntry } from '../src/server/entries';
import { invoiceTotals, payInvoice } from '../src/server/invoice-ops';
import { createLoan } from '../src/server/loans';
import { createTemplate, generateOccurrences } from '../src/server/recurring';
import * as S from '../src/server/schemas';

if (!process.env.DATABASE_URL)
  throw new Error('ui:shots: defina DATABASE_URL no .env (Postgres do docker compose).');

const DB_NAME = 'finah_shots';
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const AUTH_SECRET = 'ui-shots-secret-nao-usar-em-producao-0123456789';
const TOTP = base32Encode(Buffer.from('finah-ui-shots-totp!'));
const USER = { email: 'eduardo@shots.test', password: 'senha-shots-eduardo' };

const [label = 'atual', filter] = process.argv.slice(2);
const OUT = `tmp/ui-shots/${label}`;

const dbUrl = (name: string) => {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${name}`;
  return u.toString();
};

/** Centavos → "1234,56" (formato aceito pelos schemas), sem float. */
const brl = (c: number) => `${Math.floor(c / 100)},${String(c % 100).padStart(2, '0')}`;

// ───────────────────────────── dados fictícios ─────────────────────────────

async function populate(db: AnyDB, hoje: ISODate) {
  const m0 = monthStart(hoje);
  /** dia `day` do mês `offset` (0 = atual, -1 = anterior…) */
  const d = (offset: number, day: number) => dateInMonth(addMonths(m0, offset), day);
  const month = (offset: number) => toMonthParam(addMonths(m0, offset));
  const start = d(-2, 1);

  await seed(
    db,
    seedConfigFromEnv({
      SEED_USER1_NAME: 'Eduardo',
      SEED_USER1_EMAIL: USER.email,
      SEED_USER1_PASSWORD: USER.password,
      SEED_USER1_COLOR: '#2563eb',
      SEED_USER2_NAME: 'Viviane',
      SEED_USER2_EMAIL: 'viviane@shots.test',
      SEED_USER2_PASSWORD: 'senha-shots-viviane',
      SEED_USER2_COLOR: '#db2777',
      SEED_ACCOUNT_NAME: 'Conta principal',
      SEED_OPENING_BALANCE: '8.450,00',
      SEED_OPENING_BALANCE_DATE: start,
    }),
  );
  await db
    .update(users)
    .set({ totpSecret: seal(TOTP, deriveKey(AUTH_SECRET)), totpEnabledAt: new Date() })
    .where(eq(users.email, USER.email));

  const us = await db.select().from(users);
  const edu = us.find((u) => u.email === USER.email)!.id;
  const vivi = us.find((u) => u.email !== USER.email)!.id;
  const cats = await db.select().from(categories);
  const cat = (name: string, kind: 'EXPENSE' | 'INCOME' = 'EXPENSE') =>
    cats.find((c) => c.name === name && c.kind === kind)!.id;
  const who = (w?: string) => (w === 'v' ? vivi : w === 'e' ? edu : undefined);
  const ctx = (day: ISODate = hoje, userId = edu) => ({ db, userId, today: day });

  const tpl = (o: Record<string, string>) =>
    createTemplate(ctx(start), S.templateInput.parse({ startMonth: month(-2), paymentMethod: 'PIX', ...o }));
  const income = { type: 'FIXED', direction: 'INCOME', paymentMethod: 'BANK_TRANSFER' };
  await tpl({
    ...income,
    description: 'Salário Eduardo',
    categoryId: cat('Salário CLT', 'INCOME'),
    amount: '7.800,00',
    dayOfMonth: '5',
    beneficiaryUserId: edu,
  });
  await tpl({
    ...income,
    description: 'Salário Viviane',
    categoryId: cat('Salário CLT', 'INCOME'),
    amount: '5.200,00',
    dayOfMonth: '28',
    beneficiaryUserId: vivi,
  });
  const bill = (
    type: string,
    description: string,
    c: string,
    amount: string,
    day: string,
    pm: string,
    w?: string,
  ) =>
    tpl({
      type,
      direction: 'EXPENSE',
      description,
      categoryId: cat(c),
      amount,
      dayOfMonth: day,
      paymentMethod: pm,
      ...(w ? { beneficiaryUserId: who(w)! } : {}),
    });
  await bill('FIXED', 'Aluguel apartamento', 'Moradia', '2.350,00', '10', 'BOLETO');
  await bill('FIXED', 'Condomínio', 'Moradia', '680,00', '8', 'BOLETO');
  await bill('FIXED', 'Internet fibra 500 mega', 'Contas da casa', '99,90', '18', 'AUTO_DEBIT');
  await bill('RECURRING_VARIABLE', 'Conta de luz', 'Contas da casa', '210,00', '22', 'BOLETO');
  await bill('RECURRING_VARIABLE', 'Água e esgoto', 'Contas da casa', '95,00', '15', 'BOLETO');
  await bill('FIXED', 'Escola das crianças', 'Filhos', '1.450,00', '5', 'BOLETO');
  await bill('FIXED', 'Academia', 'Cuidados pessoais', '119,90', '12', 'DEBIT', 'v');

  const card = async (o: Record<string, string>) =>
    (await createCard(ctx(start), S.cardInput.parse({ botAliases: '', ...o }))).id;
  const nubank = await card({
    name: 'Nubank Ultravioleta',
    issuer: 'Nubank',
    last4: '4821',
    limitTotal: '12.000,00',
    closingDay: '3',
    dueDay: '10',
  });
  const inter = await card({
    name: 'Inter Black',
    issuer: 'Banco Inter',
    last4: '0937',
    limitTotal: '9.500,00',
    closingDay: '25',
    dueDay: '5',
  });
  const extra = await card({
    name: 'Adicional da sogra',
    issuer: 'Itaú',
    last4: '1122',
    isAdditional: 'on',
    holderName: 'Maria Helena',
    closingDay: '15',
    dueDay: '22',
  });

  await tpl({
    type: 'FIXED',
    direction: 'EXPENSE',
    description: 'Netflix Premium',
    categoryId: cat('Assinaturas'),
    amount: '59,90',
    dayOfMonth: '14',
    paymentMethod: 'CREDIT_CARD',
    creditCardId: nubank,
  });
  await tpl({
    type: 'FIXED',
    direction: 'EXPENSE',
    description: 'Spotify Família',
    categoryId: cat('Assinaturas'),
    amount: '34,90',
    dayOfMonth: '20',
    paymentMethod: 'CREDIT_CARD',
    creditCardId: inter,
  });

  const onboarding = (
    cardId: string,
    description: string,
    total: string,
    n: string,
    current: string,
    c: string,
  ) =>
    createOnboardingPlan(
      ctx(start),
      S.onboardingInput.parse({
        cardId,
        description,
        total,
        installments: n,
        currentInstallment: current,
        purchaseDate: d(-5, 2),
        currentInvoiceMonth: month(-2),
        categoryId: cat(c),
      }),
    );
  await onboarding(nubank, 'Geladeira Brastemp Frost Free', '4.799,00', '10', '4', 'Casa e manutenção');
  await onboarding(inter, 'Passagens férias Nordeste', '3.240,00', '6', '2', 'Viagens');

  // [mês, dia, cartão, descrição, valor, categoria, parcelas, de quem]
  const purchases: [number, number, string, string, string, string, string?, string?][] = [
    [-2, 4, nubank, 'Supermercado Pão de Açúcar', '642,18', 'Mercado'],
    [-2, 9, nubank, 'iFood - Outback', '187,40', 'Alimentação fora'],
    [-2, 15, inter, 'Posto Shell', '280,00', 'Transporte'],
    [-2, 21, nubank, 'Zara Shopping Iguatemi', '459,70', 'Compras', '3', 'v'],
    [-2, 26, inter, 'Drogasil', '96,35', 'Saúde'],
    [-1, 2, nubank, 'Atacadão', '812,55', 'Mercado'],
    [-1, 6, nubank, 'Uber', '43,90', 'Transporte', '1', 'e'],
    [-1, 12, inter, 'Notebook Dell Inspiron 15', '4.299,00', 'Compras', '12', 'e'],
    [-1, 18, nubank, 'Cinema Cinemark + pipoca', '126,00', 'Lazer'],
    [-1, 26, inter, 'Petz - ração e areia', '238,40', 'Outros'],
    [0, 1, nubank, 'Hortifruti Natural da Terra', '154,32', 'Mercado'],
    [0, 4, nubank, 'Supermercado Pão de Açúcar', '701,09', 'Mercado'],
    [0, 7, nubank, 'Amazon - fone Bluetooth', '349,00', 'Compras', '2', 'e'],
    [0, 11, inter, 'Restaurante Coco Bambu - aniversário', '412,60', 'Alimentação fora'],
    [0, 16, nubank, 'Farmácia São Paulo', '78,45', 'Saúde', '1', 'v'],
    [0, 19, extra, 'Magazine Luiza - air fryer', '599,00', 'Casa e manutenção', '5'],
    [0, 22, nubank, 'Posto Ipiranga', '250,00', 'Transporte'],
    [0, 24, inter, 'Salão de beleza', '220,00', 'Cuidados pessoais', '1', 'v'],
    [0, 27, nubank, 'Mercado Livre - presente de aniversário', '189,90', 'Presentes'],
  ];
  for (const [off, day, cardId, description, amount, c, n = '1', w] of purchases) {
    const date = d(off, day);
    if (date > hoje) continue; // compra no futuro não existe
    await createCardPurchase(
      ctx(date, w === 'v' ? vivi : edu),
      S.cardPurchaseInput.parse({
        cardId,
        amount,
        installments: n,
        description,
        categoryId: cat(c),
        date,
        beneficiaryUserId: who(w),
      }),
    );
  }

  // [mês, dia, tipo, descrição, valor, categoria, meio, de quem, pago]
  const entries: [number, number, 'INCOME' | 'EXPENSE', string, string, string, string, string?, string?][] =
    [
      [-2, 12, 'EXPENSE', 'Feira de domingo', '86,50', 'Mercado', 'CASH'],
      [-2, 19, 'INCOME', 'Freela design logotipo', '1.200,00', 'Renda extra', 'PIX', 'v'],
      [-1, 3, 'EXPENSE', 'Pediatra Dra. Ana', '450,00', 'Filhos', 'PIX'],
      [-1, 21, 'EXPENSE', 'Barbeiro', '60,00', 'Cuidados pessoais', 'PIX', 'e'],
      [0, 2, 'EXPENSE', 'Conserto da máquina de lavar', '320,00', 'Casa e manutenção', 'PIX'],
      [0, 13, 'INCOME', 'Venda bicicleta usada OLX', '650,00', 'Renda extra', 'PIX'],
      [0, 20, 'EXPENSE', 'IPVA - parcela 3', '412,77', 'Transporte', 'BOLETO'],
      [0, 26, 'EXPENSE', 'Pizza sexta à noite', '94,00', 'Alimentação fora', 'PIX'],
      [1, 7, 'EXPENSE', 'Seguro do carro - parcela', '289,40', 'Transporte', 'BOLETO', undefined, 'false'],
    ];
  for (const [off, day, kind, description, amount, c, pm, w, paid = 'true'] of entries) {
    const date = d(off, day);
    if (date > hoje && paid === 'true') continue;
    await createEntry(
      ctx(date),
      S.entryInput.parse({
        kind,
        description,
        amount,
        categoryId: cat(c, kind),
        paymentMethod: pm,
        date,
        beneficiaryUserId: who(w),
        paid,
      }),
    );
  }

  await createLoan(
    ctx(d(-1, 10)),
    S.loanInput.parse({
      name: 'Empréstimo consignado',
      lender: 'Caixa',
      principal: '6.000,00',
      total: '7.320,00',
      installments: '12',
      receivedDate: d(-1, 10),
      firstDueDate: d(0, 10),
    }),
  );

  await createBenefitCard(
    ctx(start),
    S.benefitCardInput.parse({
      name: 'Flash',
      issuer: 'Flash',
      last4: '7788',
      creditRule: 'LAST_BUSINESS_DAY',
      startMonth: month(-2),
      wallets: [
        { name: 'Alimentação', monthlyCredit: '900,00', openingBalance: '320,00' },
        { name: 'Refeição', monthlyCredit: '660,00', openingBalance: '150,00' },
      ],
    }),
  );
  await generateBenefitCredits(db, hoje);
  const wallets = await db.select().from(benefitWallets);
  for (const [i, w] of wallets.entries()) {
    const date = d(0, Math.min(1 + i * 4, Number(hoje.slice(8))));
    await createBenefitSpend(
      ctx(date),
      S.benefitSpendInput.parse({
        walletId: w.id,
        amount: i ? '48,90' : '387,22',
        description: i ? 'Almoço restaurante por quilo' : 'Carrefour compra do mês',
        categoryId: cat(i ? 'Alimentação fora' : 'Mercado'),
        date,
      }),
    );
  }

  // contas dos fixos: paga o que venceu há mais de 10 dias (o resto fica pendente/vencido, para aparecer na tela)
  await generateOccurrences(db, hoje);
  const pending = await db.select().from(transactions).where(eq(transactions.status, 'PENDING'));
  for (const t of pending) {
    if (!t.dueDate || t.loanId || t.dueDate >= addDays(hoje, -10)) continue;
    await confirmPayment(
      ctx(t.dueDate),
      t.id,
      t.version,
      S.confirmPaymentInput.parse({ date: t.dueDate, amount: brl(t.amountCents) }),
    );
  }
  // faturas já vencidas: pagas no vencimento
  for (const inv of await db.select().from(invoices)) {
    if (inv.dueDate >= hoje) continue;
    const t = await db.transaction((tx) => invoiceTotals(tx, inv.id));
    const due = t.totalCents - t.paidCents;
    if (due > 0)
      await payInvoice(
        ctx(inv.dueDate),
        inv.id,
        S.invoicePaymentInput.parse({ amount: brl(due), date: inv.dueDate, paymentMethod: 'PIX' }),
      );
  }
}

async function resetDatabase(hoje: ISODate) {
  const admin = postgres(dbUrl('postgres'), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
  await admin.unsafe(`create database ${DB_NAME}`);
  await admin.end();
  const { db, client } = createDb(dbUrl(DB_NAME), { max: 1 });
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    await populate(db, hoje);
  } finally {
    await client.end();
  }
}

/** ids das telas de detalhe (uma de cada) */
async function detailIds() {
  const sql = postgres(dbUrl(DB_NAME), { max: 1 });
  const one = async (q: string) => ((await sql.unsafe(q))[0] as { id: string } | undefined)?.id;
  try {
    return {
      card: await one(`select id from credit_cards where name like 'Nubank%'`),
      invoice: await one(`select i.id from invoices i join credit_cards c on c.id = i.credit_card_id
        where c.name like 'Nubank%' and i.due_date >= current_date order by i.due_date limit 1`),
      plan: await one(`select p.id from installment_plans p join transactions t on t.id = p.transaction_id
        where t.description like 'Notebook%'`),
      entry: await one(`select id from transactions where description = 'Conserto da máquina de lavar'`),
      loan: await one(`select id from loans limit 1`),
      benefit: await one(`select id from benefit_cards limit 1`),
      template: await one(`select id from recurring_templates where description = 'Aluguel apartamento'`),
    };
  } finally {
    await sql.end();
  }
}

// ───────────────────────────── servidor e capturas ─────────────────────────────

function startServer() {
  // o binário do next direto pelo node: sem shell no meio
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', String(PORT)], {
    stdio: 'ignore',
    env: {
      ...process.env,
      DATABASE_URL: dbUrl(DB_NAME),
      AUTH_SECRET,
      AUTH_URL: BASE,
      BOT_MODE: 'off',
      NEXT_DIST_DIR: '.next-shots',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  return server;
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('ui:shots: o next dev não respondeu em 2 minutos.');
}

/** o app recusa o mesmo código duas vezes no mesmo passo de 30 s: cada login espera um código novo */
let lastStep = -1;

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Senha').fill(USER.password);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Código').waitFor({ timeout: 120_000 });
  while (totpStep(Date.now()) === lastStep) await page.waitForTimeout(1000);
  lastStep = totpStep(Date.now());
  await page.getByLabel('Código').fill(totpCode(TOTP, lastStep));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: /Olá,/ }).waitFor({ timeout: 120_000 });
}

const MOBILE = { ...devices['iPhone 13'], viewport: { width: 375, height: 812 }, deviceScaleFactor: 1.6 };
const DESKTOP = { viewport: { width: 1280, height: 800 } };
/** altura de cada fatia das capturas longas do celular (cabe legível numa imagem) */
const SLICE = 1150;

async function capture(browser: Browser, routes: [string, string][]) {
  for (const [tag, options] of [
    ['m', MOBILE],
    ['d', DESKTOP],
  ] as const) {
    mkdirSync(`${OUT}/${tag}`, { recursive: true });
    const context = await browser.newContext({
      ...options,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });
    const page = await context.newPage();
    await login(page);
    for (const [name, path] of routes) {
      if (filter && !name.includes(filter)) continue;
      const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 120_000 });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (tag === 'd') {
        await page.screenshot({ path: `${OUT}/d/${name}.png`, fullPage: true });
      } else {
        // a 1ª tela como o usuário vê (com a barra inferior); depois a página inteira em fatias, sem os fixos
        await page.screenshot({ path: `${OUT}/m/${name}-0.png` });
        await page.addStyleTag({ content: '.fixed{display:none!important}' });
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0, k = 1; y < height; y += SLICE, k++)
          await page.screenshot({
            path: `${OUT}/m/${name}-${k}.png`,
            fullPage: true,
            clip: { x: 0, y, width: 375, height: Math.min(SLICE, height - y) },
          });
      }
      console.log(
        `${tag} ${name.padEnd(22)} ${res?.status()}${overflow > 0 ? `  ROLAGEM LATERAL ${overflow}px` : ''}`,
      );
    }
    await context.close();
  }
}

/** estados que só aparecem com toque: painel do (+), "Paguei", filtros */
async function captureInteractions(browser: Browser) {
  mkdirSync(`${OUT}/i`, { recursive: true });
  const context = await browser.newContext({ ...MOBILE, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await context.newPage();
  await login(page);
  const shot = async (name: string) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/i/${name}.png` });
    console.log(`i ${name}`);
  };
  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  await shot('novo-lancamento-painel');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: /Paguei|Recebi/ })
    .first()
    .click();
  await shot('paguei');
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/lancamentos`);
  await page.getByText('Filtros').first().click();
  await shot('lancamentos-filtros');
  await context.close();
}

async function main() {
  const hoje = today();
  console.log(`ui:shots → ${OUT} (banco ${DB_NAME}, hoje ${hoje})`);
  await resetDatabase(hoje);
  const ids = await detailIds();
  if (!filter) rmSync(OUT, { recursive: true, force: true }); // com filtro, só substitui as telas filtradas

  const routes: [string, string][] = [
    ['inicio', '/'],
    ['lancamentos', '/lancamentos'],
    ['lancamento-novo', '/lancamentos/novo'],
    ['lancamento-detalhe', `/lancamentos/${ids.entry}`],
    ['lancamentos-importar', '/lancamentos/importar'],
    ['mais', '/mais'],
    ['cartoes', '/cartoes'],
    ['cartao', `/cartoes/${ids.card}`],
    ['cartao-novo', '/cartoes/novo'],
    ['cartao-em-andamento', `/cartoes/${ids.card}/em-andamento`],
    ['cartao-importar', `/cartoes/${ids.card}/importar`],
    ['fatura', `/cartoes/faturas/${ids.invoice}`],
    ['compra-parcelada', `/cartoes/compras/${ids.plan}`],
    ['fixos', '/fixos'],
    ['fixo-novo', '/fixos/novo'],
    ['fixo', `/fixos/${ids.template}`],
    ['conferencia', '/conta/conferencia'],
    ['emprestimos', '/emprestimos'],
    ['emprestimo-novo', '/emprestimos/novo'],
    ['emprestimo', `/emprestimos/${ids.loan}`],
    ['beneficio', `/beneficios/${ids.benefit}`],
    ['beneficio-novo', '/beneficios/novo'],
    ['relatorios', '/relatorios'],
    ['projecao', '/relatorios/projecao'],
    ['resumo-entrou', '/resumo/entrou'],
    ['resumo-saiu', '/resumo/saiu'],
    ['ajustes', '/ajustes'],
    ['categorias', '/ajustes/categorias'],
  ];

  const server = startServer();
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`);
    await page.screenshot({ path: (mkdirSync(`${OUT}/m`, { recursive: true }), `${OUT}/m/login.png`) });
    await page.close();
    await capture(browser, routes);
    if (!filter) await captureInteractions(browser);
  } finally {
    await browser.close();
    // o next dev abre processos filhos: no Windows, derruba a árvore inteira
    if (process.platform === 'win32')
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill('SIGTERM');
  }
  console.log(`pronto: ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
