import { describe, expect, it } from 'vitest';
import { planClosingChange, type ClosingChange, type PlanPlacement } from './reallocation';

const change = (over: Partial<ClosingChange> = {}): ClosingChange => ({
  referenceMonth: '2026-11-01',
  oldClosing: '2026-11-03',
  newClosing: '2026-11-03',
  dueDate: '2026-11-10',
  prevClosing: '2026-10-03',
  nextClosing: '2026-12-03',
  today: '2026-10-20',
  ...over,
});

const plan = (
  over: Partial<PlanPlacement> & Pick<PlanPlacement, 'planId' | 'purchaseDate'>,
): PlanPlacement => ({
  description: over.planId,
  firstReferenceMonth: '2026-11-01',
  onboarding: false,
  movable: true,
  ...over,
});

describe('planClosingChange (D27)', () => {
  it('fechamento antecipado: compras depois do novo fechamento andam uma fatura', () => {
    const r = planClosingChange(change({ newClosing: '2026-11-01' }), [
      plan({ planId: 'a', purchaseDate: '2026-10-31' }),
      plan({ planId: 'b', purchaseDate: '2026-11-01' }),
      plan({ planId: 'c', purchaseDate: '2026-11-02' }),
    ]);
    expect(r).toEqual({
      forward: [expect.objectContaining({ planId: 'b' }), expect.objectContaining({ planId: 'c' })],
      backward: [],
    });
  });

  it('fechamento adiado: compras da fatura seguinte antes do novo fechamento voltam', () => {
    const r = planClosingChange(change({ newClosing: '2026-11-05' }), [
      plan({ planId: 'x', purchaseDate: '2026-11-04', firstReferenceMonth: '2026-12-01' }),
      plan({ planId: 'y', purchaseDate: '2026-11-05', firstReferenceMonth: '2026-12-01' }),
      plan({ planId: 'z', purchaseDate: '2026-09-20', firstReferenceMonth: '2026-12-01' }), // antes da janela: não mexe
    ]);
    expect(r).toEqual({ forward: [], backward: [expect.objectContaining({ planId: 'x' })] });
  });

  it('onboarding nunca é realocado', () => {
    const r = planClosingChange(change({ newClosing: '2026-11-01' }), [
      plan({ planId: 'o', purchaseDate: '2026-11-02', onboarding: true }),
    ]);
    expect(r).toEqual({ forward: [], backward: [] });
  });

  it('compra com parcela antecipada/estornada bloqueia', () => {
    const r = planClosingChange(change({ newClosing: '2026-11-01' }), [
      plan({ planId: 'tv', purchaseDate: '2026-11-02', movable: false, description: 'TV' }),
    ]);
    expect(r).toHaveProperty('error', expect.stringContaining('"TV"'));
  });

  it.each([
    [{ today: '2026-11-03' }, 'fatura aberta'],
    [{ newClosing: '2026-11-10' }, 'antes do vencimento'],
    [{ newClosing: '2026-10-03' }, 'fatura anterior'],
    [{ newClosing: '2026-12-03', dueDate: '2026-12-31' }, 'fatura seguinte'],
  ] as const)('validação %o', (over, msg) => {
    expect(planClosingChange(change(over), [])).toHaveProperty('error', expect.stringContaining(msg));
  });
});
