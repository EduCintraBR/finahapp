import { defineConfig, devices } from '@playwright/test';
import { e2eEnv } from './tests/e2e/env';

/**
 * E2E no navegador (Chromium) contra `next dev` na porta 3100 e um banco SEPARADO (finah_e2e),
 * recriado a cada execução. Precisa do Postgres do Compose no ar: `docker compose up -d db`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: e2eEnv.baseURL,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    viewport: { width: 375, height: 812 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec next dev --port 3100',
    // /login não depende do banco: o webServer sobe ANTES do globalSetup criar o finah_e2e.
    url: `${e2eEnv.baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eEnv.databaseUrl,
      AUTH_SECRET: e2eEnv.authSecret,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_DIST_DIR: '.next-e2e',
    },
  },
});
