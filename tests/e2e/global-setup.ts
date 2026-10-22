import { chromium } from '@playwright/test';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createDb } from '../../src/db/client';
import { seed, seedConfigFromEnv } from '../../src/db/seed';
import { monthStart, today } from '../../src/domain/dates';
import { E2E_DB, e2eEnv } from './env';

/** Recria o banco finah_e2e do zero: migrações + seed com os usuários de teste. */
export default async function globalSetup() {
  const admin = postgres(e2eEnv.adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${E2E_DB} with (force)`);
  await admin.unsafe(`create database ${E2E_DB}`);
  await admin.end();

  const { db, client } = createDb(e2eEnv.databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    const { eduardo, viviane } = e2eEnv.users;
    await seed(
      db,
      seedConfigFromEnv({
        SEED_USER1_NAME: eduardo.name,
        SEED_USER1_EMAIL: eduardo.email,
        SEED_USER1_PASSWORD: eduardo.password,
        SEED_USER1_COLOR: '#2563eb',
        SEED_USER2_NAME: viviane.name,
        SEED_USER2_EMAIL: viviane.email,
        SEED_USER2_PASSWORD: viviane.password,
        SEED_USER2_COLOR: '#db2777',
        SEED_OPENING_BALANCE: e2eEnv.openingBalance,
        SEED_OPENING_BALANCE_DATE: monthStart(today()),
      }),
    );
  } finally {
    await client.end();
  }
  await warmUp();
}

/**
 * O `next dev` compila cada rota na primeira visita (o Início, com os gráficos, leva vários segundos num CI frio),
 * o que estourava o tempo do 1º teste. Entra e abre as telas uma vez antes de começar.
 */
const WARM_ROUTES = [
  '/lancamentos',
  '/lancamentos/novo',
  '/lancamentos/importar',
  '/cartoes',
  '/cartoes/novo',
  '/fixos',
  '/fixos/novo',
  '/conta/conferencia',
  '/relatorios',
  '/relatorios/projecao',
  '/ajustes',
  '/ajustes/categorias',
];

async function warmUp() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: e2eEnv.baseURL });
    await page.goto('/login');
    await page.getByLabel('Email').fill(e2eEnv.users.eduardo.email);
    await page.getByLabel('Senha').fill(e2eEnv.users.eduardo.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('heading', { name: /Olá,/ }).waitFor({ timeout: 90_000 });
    for (const path of WARM_ROUTES) await page.goto(path);
  } finally {
    await browser.close();
  }
}
