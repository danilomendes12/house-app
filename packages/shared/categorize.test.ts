import { describe, expect, it } from 'vitest';
import { categorize, matchRule, sortRules, suggestMatcher, type CategoryRule } from './categorize';

function rule(id: string, matcher: string, categoryId: string, priority = 0): CategoryRule {
  return { id, matcher, categoryId, priority };
}

describe('matchRule', () => {
  const rules = sortRules([
    rule('r1', 'uber', 'transporte'),
    rule('r2', 'uber eats', 'restaurantes'),
    rule('r3', 'pao de acucar', 'mercado'),
  ]);

  it('matches a substring anywhere in the description', () => {
    expect(matchRule('CORRIDA UBER 4821', rules)?.categoryId).toBe('transporte');
  });

  it('prefers the longer matcher at equal priority', () => {
    expect(matchRule('UBER EATS SP', rules)?.categoryId).toBe('restaurantes');
  });

  it('ignores accents on both sides', () => {
    expect(matchRule('PAO DE ACUCAR 123', rules)?.categoryId).toBe('mercado');
    expect(matchRule('Pão de Açúcar', rules)?.categoryId).toBe('mercado');
  });

  it('returns null when nothing matches, leaving it for the queue', () => {
    expect(matchRule('Farmácia Onofre', rules)).toBeNull();
  });

  it('returns null for an empty description', () => {
    expect(matchRule('', rules)).toBeNull();
  });

  it('lets an explicit priority beat matcher length', () => {
    const prioritized = sortRules([
      rule('r1', 'uber eats', 'restaurantes'),
      rule('r2', 'uber', 'transporte', 10),
    ]);

    expect(matchRule('UBER EATS SP', prioritized)?.categoryId).toBe('transporte');
  });
});

describe('sortRules', () => {
  it('orders by priority desc, then matcher length desc', () => {
    const sorted = sortRules([
      rule('a', 'ab', 'x', 0),
      rule('b', 'abcd', 'x', 0),
      rule('c', 'a', 'x', 5),
    ]);

    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const rules = [rule('a', 'x', 'x', 0), rule('b', 'y', 'y', 9)];
    sortRules(rules);

    expect(rules.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('categorize', () => {
  it('sorts before matching, so callers can pass rules in any order', () => {
    const unsorted = [rule('r1', 'uber', 'transporte'), rule('r2', 'uber eats', 'restaurantes')];

    expect(categorize('Uber Eats', unsorted)).toBe('restaurantes');
  });
});

describe('suggestMatcher', () => {
  it('takes the first significant words', () => {
    expect(suggestMatcher('PADARIA SAO JOAO LTDA')).toBe('padaria sao');
  });

  it('drops an instalment suffix', () => {
    expect(suggestMatcher('Magazine Luiza - Parcela 3/10')).toBe('magazine luiza');
  });

  it('drops short words and bare numbers that only match one purchase', () => {
    expect(suggestMatcher('Uber *do 4821')).toBe('uber');
  });

  it('falls back to the whole description when nothing survives', () => {
    expect(suggestMatcher('99 SP')).toBe('99 sp');
  });
});
