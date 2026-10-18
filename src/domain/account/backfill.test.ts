import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planBackfill } from './backfill';

const OPENING = { openingDate: '2026-10-01', openingCents: 184_582 };

describe('recuar o início do controle (D50)', () => {
  it('sem linhas anteriores ao início, não há o que recuar', () => {
    expect(
      planBackfill({
        ...OPENING,
        fileStart: '2026-10-01',
        fileEnd: '2026-10-17',
        ledgerCents: 0,
        lines: [{ date: '2026-10-02', signedCents: -1000 }],
      }),
    ).toBeNull();
  });

  it('extrato de setembro completo: saldo inicial = saldo final do arquivo − movimento, e confere com o atual', () => {
    const plan = planBackfill({
      ...OPENING,
      fileStart: '2026-09-01',
      fileEnd: '2026-09-30',
      ledgerCents: 184_582, // o banco diz que terminou setembro com o saldo que o app tem em 01/10
      lines: [
        { date: '2026-09-05', signedCents: 100_000 },
        { date: '2026-09-10', signedCents: -20_000 },
      ],
    })!;
    expect(plan).toMatchObject({
      newDate: '2026-09-01',
      newOpeningCents: 104_582,
      method: 'LEDGER',
      earlyLines: 2,
      check: { status: 'OK' },
      blocking: false,
    });
  });

  it('saldo final do arquivo diferente do saldo inicial atual: bloqueia e mostra a diferença', () => {
    const plan = planBackfill({
      ...OPENING,
      fileStart: '2026-09-01',
      fileEnd: '2026-09-30',
      ledgerCents: 190_000,
      lines: [{ date: '2026-09-05', signedCents: 1 }],
    })!;
    expect(plan.check).toEqual({
      status: 'MISMATCH',
      fileBalanceCents: 190_000,
      appOpeningCents: 184_582,
      diffCents: 5_418,
    });
    expect(plan.blocking).toBe(true);
  });

  it('arquivo que passa de 01/10: confere o saldo na virada usando só as linhas a partir dela', () => {
    const plan = planBackfill({
      ...OPENING,
      fileStart: '2026-09-20',
      fileEnd: '2026-10-05',
      ledgerCents: 150_000,
      lines: [
        { date: '2026-09-25', signedCents: 50_000 },
        { date: '2026-10-03', signedCents: -34_582 },
      ],
    })!;
    // saldo na virada segundo o arquivo = 150.000 + 34.582 = 184.582 = saldo inicial atual
    expect(plan.check).toEqual({ status: 'OK' });
    expect(plan.newOpeningCents).toBe(150_000 - (50_000 - 34_582));
  });

  it('arquivo que termina antes de 30/09: com o saldo do banco avisa da lacuna, sem bloquear', () => {
    const plan = planBackfill({
      ...OPENING,
      fileStart: '2026-09-01',
      fileEnd: '2026-09-20',
      ledgerCents: 100_000,
      lines: [{ date: '2026-09-05', signedCents: 10_000 }],
    })!;
    expect(plan.check).toEqual({ status: 'GAP', from: '2026-09-21', to: '2026-09-30' });
    expect(plan.newOpeningCents).toBe(90_000);
    expect(plan.blocking).toBe(false);
  });

  it('sem saldo no arquivo (CSV): parte do saldo atual e desconta o movimento; não dá para conferir', () => {
    const plan = planBackfill({
      ...OPENING,
      fileStart: null,
      fileEnd: null,
      ledgerCents: null,
      lines: [
        { date: '2026-09-05', signedCents: 100_000 },
        { date: '2026-09-30', signedCents: -20_000 },
      ],
    })!;
    expect(plan).toMatchObject({
      newDate: '2026-09-05',
      newOpeningCents: 184_582 - 80_000,
      method: 'CONTINUITY',
      check: { status: 'UNVERIFIABLE' },
      blocking: false,
    });
  });

  it('sem saldo no arquivo e com lacuna até 01/10: bloqueia (o saldo calculado estaria errado)', () => {
    const plan = planBackfill({
      ...OPENING,
      fileStart: '2026-09-01',
      fileEnd: '2026-09-15',
      ledgerCents: null,
      lines: [{ date: '2026-09-05', signedCents: 100 }],
    })!;
    expect(plan.check).toMatchObject({ status: 'GAP' });
    expect(plan.blocking).toBe(true);
  });

  it('invariante: com o saldo do arquivo, saldo inicial novo + movimento do arquivo = saldo final do arquivo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5_000_000, max: 5_000_000 }),
        fc.array(fc.integer({ min: -2_000_000, max: 2_000_000 }), { minLength: 1, maxLength: 40 }),
        (ledger, amounts) => {
          const lines = amounts.map((signedCents, i) => ({
            date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
            signedCents,
          }));
          const plan = planBackfill({
            ...OPENING,
            fileStart: '2026-09-01',
            fileEnd: '2026-09-30',
            ledgerCents: ledger,
            lines,
          })!;
          const net = amounts.reduce((s, v) => s + v, 0);
          expect(plan.newOpeningCents + net).toBe(ledger);
        },
      ),
    );
  });
});
