import { connection } from 'next/server';
import { getDb } from '@/db/client';
import { today } from '@/domain/dates';
import { generateOccurrences } from './recurring';

/**
 * Disparo "ao abrir o mês" (SPEC §4): garante as ocorrências até hoje caso o worker não tenha rodado.
 * Idempotente e barato; uma falha aqui nunca derruba a tela.
 */
export async function ensureOccurrences(): Promise<void> {
  // Só com uma requisição de verdade: nunca escrever no banco durante o `next build`.
  await connection();
  try {
    await generateOccurrences(getDb(), today());
  } catch (err) {
    console.error('[ocorrências] falha ao gerar:', err);
  }
}
