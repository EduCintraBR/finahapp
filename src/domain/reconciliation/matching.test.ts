import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { assignMatches, matchScore, similarity, type MatchLine } from './matching';

const l = (over: Partial<MatchLine> & Pick<MatchLine, 'id'>): MatchLine => ({
  amountCents: 5000,
  date: '2026-10-16',
  description: 'Ifood *Restaurante',
  installmentNumber: null,
  ...over,
});

describe('matchScore', () => {
  it('valor precisa ser exato', () => {
    expect(matchScore(l({ id: 'a' }), l({ id: 'b', amountCents: 5001 }))).toBeNull();
  });
  it('à vista: até ±3 dias, mais perto = maior score', () => {
    const same = matchScore(l({ id: 'a' }), l({ id: 'b' }))!;
    const one = matchScore(l({ id: 'a' }), l({ id: 'b', date: '2026-10-17' }))!;
    expect(same).toBeGreaterThan(one);
    expect(matchScore(l({ id: 'a' }), l({ id: 'b', date: '2026-10-20' }))).toBeNull();
  });
  it('parcela: mesmo número k, a data não importa', () => {
    const line = l({ id: 'a', installmentNumber: 7, date: '2026-10-09' });
    expect(matchScore(line, l({ id: 'b', installmentNumber: 7, date: '2026-04-20' }))).not.toBeNull();
    expect(matchScore(line, l({ id: 'b', installmentNumber: 6, date: '2026-10-09' }))).toBeNull();
  });
  it('compra à vista não casa com parcela 2+', () => {
    expect(matchScore(l({ id: 'a' }), l({ id: 'b', installmentNumber: 2 }))).toBeNull();
  });
  it('semelhança de descrição', () => {
    expect(similarity('Mister Graos Ss Centro', 'Mister Graos (Ameixa Liz)')).toBeGreaterThan(0.3);
    expect(similarity('Uber', 'Mercado')).toBe(0);
  });
});

describe('assignMatches (1:1)', () => {
  it('ambiguidade: dois iFoods de mesmo valor na mesma semana → cada linha com o lançamento mais próximo', () => {
    const lines = [l({ id: 'linha-seg', date: '2026-10-12' }), l({ id: 'linha-qua', date: '2026-10-14' })];
    const cands = [l({ id: 'lanc-qua', date: '2026-10-14' }), l({ id: 'lanc-seg', date: '2026-10-12' })];
    expect(assignMatches(lines, cands).map((a) => [a.lineId, a.candidateId])).toEqual([
      ['linha-qua', 'lanc-qua'],
      ['linha-seg', 'lanc-seg'],
    ]);
  });

  it('dois lançamentos iguais e uma linha só: só um é usado', () => {
    const r = assignMatches([l({ id: 'x' })], [l({ id: 'c1' }), l({ id: 'c2' })]);
    expect(r).toHaveLength(1);
  });

  it('descrição desempata', () => {
    const r = assignMatches(
      [l({ id: 'x', description: 'Uber Trip' })],
      [l({ id: 'mercado', description: 'Mercado' }), l({ id: 'uber', description: 'Uber' })],
    );
    expect(r[0]!.candidateId).toBe('uber');
  });

  it('property: nunca reutiliza linha nem lançamento, e só casa valores iguais', () => {
    const item = fc.record({
      amountCents: fc.constantFrom(1000, 2000, 3000),
      offset: fc.integer({ min: 0, max: 10 }),
    });
    fc.assert(
      fc.property(fc.array(item, { maxLength: 8 }), fc.array(item, { maxLength: 8 }), (ls, cs) => {
        const lines = ls.map((x, i) =>
          l({ id: `l${i}`, amountCents: x.amountCents, date: addDays('2026-10-01', x.offset) }),
        );
        const cands = cs.map((x, i) =>
          l({ id: `c${i}`, amountCents: x.amountCents, date: addDays('2026-10-01', x.offset) }),
        );
        const r = assignMatches(lines, cands);
        expect(new Set(r.map((a) => a.lineId)).size).toBe(r.length);
        expect(new Set(r.map((a) => a.candidateId)).size).toBe(r.length);
        for (const a of r) {
          expect(lines.find((x) => x.id === a.lineId)!.amountCents).toBe(
            cands.find((x) => x.id === a.candidateId)!.amountCents,
          );
        }
      }),
    );
  });
});
