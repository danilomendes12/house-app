import { describe, expect, it } from 'vitest';
import {
  StatementFormatError,
  isInvoicePayment,
  parseStatement,
  parseStatementDate,
  splitInstalment,
} from './import';

const HEADER = 'date,title,amount';

function statement(...lines: string[]): string {
  return [HEADER, ...lines].join('\n');
}

describe('parseStatementDate', () => {
  it('accepts ISO dates', () => {
    expect(parseStatementDate('2026-08-17')).toBe('2026-08-17');
  });

  it('accepts DD/MM/YYYY', () => {
    expect(parseStatementDate('17/08/2026')).toBe('2026-08-17');
  });

  it('does not read 08/17/2026 as a US date', () => {
    expect(parseStatementDate('08/17/2026')).toBeNull();
  });

  it('rejects impossible calendar dates', () => {
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('2026-13-01')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseStatementDate('')).toBeNull();
    expect(parseStatementDate('ontem')).toBeNull();
  });
});

describe('isInvoicePayment', () => {
  it('matches the Nubank payment lines', () => {
    expect(isInvoicePayment('Pagamento recebido')).toBe(true);
    expect(isInvoicePayment('Pagamento em 12/08')).toBe(true);
    expect(isInvoicePayment('PAGAMENTO EFETUADO')).toBe(true);
  });

  it('leaves real purchases alone', () => {
    expect(isInvoicePayment('Pagamento de boleto Enel')).toBe(false);
    expect(isInvoicePayment('Pag Seguro Padaria')).toBe(false);
  });
});

describe('splitInstalment', () => {
  it('reads "Parcela 3/10" and strips it from the description', () => {
    expect(splitInstalment('Magazine Luiza - Parcela 3/10')).toEqual({
      description: 'Magazine Luiza',
      installmentNum: 3,
      installmentTotal: 10,
    });
  });

  it('reads the bare "3/10" suffix', () => {
    expect(splitInstalment('Magazine Luiza - 3/10')).toEqual({
      description: 'Magazine Luiza',
      installmentNum: 3,
      installmentTotal: 10,
    });
  });

  it('leaves a title without an instalment suffix untouched', () => {
    expect(splitInstalment('Mercado da esquina')).toEqual({
      description: 'Mercado da esquina',
      installmentNum: null,
      installmentTotal: null,
    });
  });

  it('ignores a suffix that cannot be an instalment', () => {
    expect(splitInstalment('Aluguel - 5/2').installmentNum).toBeNull();
  });
});

describe('parseStatement', () => {
  it('rejects a file whose header it cannot map', () => {
    expect(() => parseStatement('foo,bar\n1,2')).toThrow(StatementFormatError);
  });

  it('reads the pt-BR header with a semicolon delimiter', () => {
    const parsed = parseStatement('data;título;valor\n01/08/2026;Café;12,50');

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]).toMatchObject({
      date: '2026-08-01',
      description: 'Café',
      amountCents: 1250n,
      type: 'expense',
    });
  });

  it('treats a positive amount as an expense and a negative one as a refund', () => {
    const parsed = parseStatement(
      statement('2026-08-01,Livraria,89.90', '2026-08-05,Estorno Livraria,-89.90'),
    );

    expect(parsed.transactions.map((t) => [t.type, t.amountCents])).toEqual([
      ['expense', 8990n],
      ['income', 8990n],
    ]);
  });

  it('discards invoice payments instead of importing them as expenses', () => {
    const parsed = parseStatement(
      statement('2026-08-01,Mercado,100.00', '2026-08-10,Pagamento recebido,-1500.00'),
    );

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.skipped).toEqual([
      { line: 3, title: 'Pagamento recebido', reason: 'invoice-payment' },
    ]);
  });

  it('collects broken rows without losing the good ones', () => {
    const parsed = parseStatement(
      statement('2026-08-01,Mercado,100.00', 'ontem,Padaria,10.00', '2026-08-03,,5.00'),
    );

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.errors.map((error) => error.line)).toEqual([3, 4]);
  });

  it('records the instalment number', () => {
    const parsed = parseStatement(statement('2026-08-01,Magazine Luiza - Parcela 3/10,150.00'));

    expect(parsed.transactions[0]).toMatchObject({
      description: 'Magazine Luiza',
      installmentNum: 3,
      installmentTotal: 10,
    });
  });

  describe('dedup key (SPEC §7)', () => {
    it('is stable across parses of the same file — re-importing is a no-op', () => {
      const text = statement('2026-08-01,Mercado,100.00', '2026-08-02,Padaria,12.50');

      expect(parseStatement(text).transactions.map((t) => t.dedupSource)).toEqual(
        parseStatement(text).transactions.map((t) => t.dedupSource),
      );
    });

    it('distinguishes two legitimately identical rows by occurrence', () => {
      const parsed = parseStatement(
        statement('2026-08-01,Padaria,12.50', '2026-08-01,Padaria,12.50'),
      );

      const [first, second] = parsed.transactions.map((t) => t.dedupSource);
      expect(first).not.toBe(second);
      expect(first).toMatch(/\|0$/);
      expect(second).toMatch(/\|1$/);
    });

    it('gives an expense and a refund of the same value different keys', () => {
      const parsed = parseStatement(
        statement('2026-08-01,Livraria,89.90', '2026-08-01,Livraria,-89.90'),
      );

      const [expense, refund] = parsed.transactions.map((t) => t.dedupSource);
      expect(expense).not.toBe(refund);
    });

    it('ignores case and accent noise in the title', () => {
      const a = parseStatement(statement('2026-08-01,Padaria São João,12.50'));
      const b = parseStatement(statement('2026-08-01,PADARIA SAO JOAO,12.50'));

      expect(a.transactions[0]?.dedupSource).toBe(b.transactions[0]?.dedupSource);
    });

    it('does not collide across dates or amounts', () => {
      const parsed = parseStatement(
        statement(
          '2026-08-01,Padaria,12.50',
          '2026-08-02,Padaria,12.50',
          '2026-08-01,Padaria,12.51',
        ),
      );

      expect(new Set(parsed.transactions.map((t) => t.dedupSource)).size).toBe(3);
    });

    it('is unaffected by rows skipped in between', () => {
      const withPayment = parseStatement(
        statement(
          '2026-08-01,Padaria,12.50',
          '2026-08-10,Pagamento recebido,-500.00',
          '2026-08-01,Padaria,12.50',
        ),
      );
      const without = parseStatement(
        statement('2026-08-01,Padaria,12.50', '2026-08-01,Padaria,12.50'),
      );

      expect(withPayment.transactions.map((t) => t.dedupSource)).toEqual(
        without.transactions.map((t) => t.dedupSource),
      );
    });
  });
});
