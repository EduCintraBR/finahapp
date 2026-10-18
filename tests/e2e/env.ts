/**
 * Configuração do E2E. Usa o Postgres do `.env` (DATABASE_URL), mas num banco à parte: finah_e2e.
 * Nunca toca no banco de uso real.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const base = process.env.DATABASE_URL;
if (!base) throw new Error('E2E: defina DATABASE_URL no .env (Postgres do docker compose).');

const url = new URL(base);
export const E2E_DB = 'finah_e2e';
const e2eUrl = new URL(url);
e2eUrl.pathname = `/${E2E_DB}`;
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

export const e2eEnv = {
  baseURL: 'http://localhost:3100',
  databaseUrl: e2eUrl.toString(),
  adminUrl: adminUrl.toString(),
  authSecret: 'e2e-secret-nao-usar-em-producao-0123456789',
  users: {
    eduardo: { name: 'Eduardo', email: 'eduardo@e2e.test', password: 'senha-e2e-eduardo' },
    viviane: { name: 'Viviane', email: 'viviane@e2e.test', password: 'senha-e2e-viviane' },
  },
  openingBalance: '1.000,00',
};
