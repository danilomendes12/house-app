import { describe, expect, it } from 'vitest';
import {
  XpPositionFormatError,
  findReferenceDate,
  inferAssetType,
  parseXpDate,
  parseXpPosition,
  positionKey,
} from './xp-position';

/** A single-section file, the simplest shape the export takes. */
function positionFile(...lines: string[]): string {
  return ['Produto;Emissor;Indexador;Taxa;Vencimento;Valor bruto', ...lines].join('\n');
}

/**
 * The "posição detalhada" .xlsx as it reaches the parser: rows of cells, CSV-quoted by
 * `xlsxToDelimitedText`. Note what the header does *not* have — no column is called "produto",
 * and the first cell is the allocation share and the sub-class of the whole table.
 */
function detailedFile(...rows: string[][]): string {
  return rows
    .map((cells) => cells.map((cell) => (/[",]/.test(cell) ? `"${cell}"` : cell)).join(','))
    .join('\n');
}

/** Total investido = the three positions (R$ 25.887,61) plus the proventos (R$ 296,06). */
const DETAILED_SUMMARY: string[][] = [
  ['Danilo, este é o seu patrimônio', 'Total investido', 'Saldo Disponível'],
  ['R$ 26.197,83', 'R$ 26.183,67', 'R$ 14,16'],
];

const TESOURO_TABLE: string[][] = [
  ['Tesouro Direto', '', '', '', '', '', 'R$ 13.386,65'],
  [
    '22,7% | Prefixado',
    'Posição',
    '% Alocação',
    'Total aplicado',
    'Qtd.',
    'Disponível',
    'Vencimento',
  ],
  ['LTN jan/2027', 'R$ 13.341,16', '11,84%', 'R$ 10.553,65', '14', '14', '01/01/2027'],
  ['0% | Inflação', 'Posição', '% Alocação', 'Total aplicado', 'Qtd.', 'Disponível', 'Vencimento'],
  ['NTN-B ago/2030', 'R$ 45,49', '0,04%', 'R$ 40,18', '0,01', '0,01', '15/08/2030'],
];

const RENDA_FIXA_TABLE: string[][] = [
  ['Renda Fixa', '', '', '', '', '', 'R$ 12.500,96'],
  [
    '32,3% | Pós-Fixado',
    'Posição a mercado',
    '% Alocação',
    'Valor aplicado',
    'Valor aplicado original',
    'Taxa a mercado',
    'Data aplicação',
    'Data vencimento',
    'Quantidade',
    'Preço Unitário',
    'IR',
    'IOF',
    'Valor Líquido',
  ],
  [
    'CDB BANCO VOLKSWAGEN - SET/2026',
    'R$ 12.500,96',
    '11,1%',
    'R$ 11.000,00',
    'R$ 11.000,00',
    '100,25% CDI',
    '08/09/2025',
    '08/09/2026',
    '11',
    'R$ 1.136,45',
    'R$ 300,19',
    'R$ 0,00',
    'R$ 12.200,77',
  ],
];

const PROVENTOS_TABLE: string[][] = [
  ['Ações', '', '', '', '', '', 'R$ 296,06'],
  [
    '0,3% | Renda Variável Brasil',
    'Provisionado',
    '% Alocação',
    'Valor provisionado bruto',
    'Valor provisionado líquido',
    'Evento',
    'Previsão pagamento',
  ],
  ['EMBJ3', '50', '0,01%', 'R$ 14,04', 'R$ 11,58', 'JUROS SOBRE CAPITAL PROPRIO', '24/05/2027'],
  ['CPFE3', '125', '0,25%', 'R$ 282,02', 'R$ 282,02', 'DIVIDENDO', '30/12/2026'],
];

describe('inferAssetType', () => {
  it('reads the fixed-income families off the name', () => {
    expect(inferAssetType('CDB Banco Master 110% CDI')).toBe('cdb');
    expect(inferAssetType('LCI Bradesco 95% CDI')).toBe('lci_lca');
    expect(inferAssetType('LCA do Banco do Brasil')).toBe('lci_lca');
    expect(inferAssetType('Tesouro Selic 2029')).toBe('tesouro');
    expect(inferAssetType('NTN-B Principal 2035')).toBe('tesouro');
  });

  it('separates FIIs, ETFs and shares by ticker', () => {
    expect(inferAssetType('MXRF11 - Maxi Renda')).toBe('fii');
    expect(inferAssetType('BOVA11')).toBe('etf');
    expect(inferAssetType('PETR4')).toBe('acao');
    expect(inferAssetType('WEGE3 - WEG SA')).toBe('acao');
  });

  it('does not let "fundo" swallow a fundo imobiliário', () => {
    expect(inferAssetType('Fundo Imobiliário HGLG11')).toBe('fii');
    expect(inferAssetType('XP Macro FIC FIM')).toBe('fundo');
  });

  it('falls back to outro rather than guessing', () => {
    expect(inferAssetType('Debênture Eletrobras 2030')).toBe('outro');
    expect(inferAssetType('')).toBe('outro');
  });
});

describe('positionKey', () => {
  it('ignores casing and spacing drift between exports', () => {
    expect(positionKey('CDB  Banco X', 'XP')).toBe(positionKey('cdb banco x', 'xp'));
  });

  it('keeps the same product from two institutions apart', () => {
    expect(positionKey('CDB 110% CDI', 'Banco A')).not.toBe(positionKey('CDB 110% CDI', 'Banco B'));
  });
});

describe('parseXpDate', () => {
  it('accepts both shapes XP mixes', () => {
    expect(parseXpDate('31/07/2026')).toBe('2026-07-31');
    expect(parseXpDate('2026-07-31')).toBe('2026-07-31');
  });

  it('rejects impossible and empty dates', () => {
    expect(parseXpDate('31/02/2026')).toBeNull();
    expect(parseXpDate('')).toBeNull();
  });
});

describe('findReferenceDate', () => {
  it('reads the date out of the preamble', () => {
    expect(findReferenceDate('Posição em 31/07/2026\nProduto;Valor bruto')).toBe('2026-07-31');
    expect(findReferenceDate('Data base: 01/08/2026')).toBe('2026-08-01');
  });

  it('returns null when the file does not say', () => {
    expect(findReferenceDate('Produto;Valor bruto\nCDB;1.000,00')).toBeNull();
  });
});

describe('parseXpPosition', () => {
  it('turns a row into a snapshot draft with the enrichment columns', () => {
    const { positions, errors } = parseXpPosition(
      positionFile('CDB Banco X;Banco X;CDI;110% do CDI;15/03/2028;12.345,67'),
    );

    expect(errors).toEqual([]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      name: 'CDB Banco X',
      type: 'cdb',
      institution: 'Banco X',
      indexer: 'cdi',
      rate: 110,
      maturityDate: '2028-03-15',
      grossValueCents: 1_234_567n,
    });
  });

  it('parses money in pt-BR, never as a float', () => {
    const { positions } = parseXpPosition(
      positionFile('Tesouro Selic 2029;Tesouro;;;01/03/2029;R$ 1.234.567,89'),
    );

    expect(positions[0]?.grossValueCents).toBe(123_456_789n);
  });

  it('reads every section of a multi-table file', () => {
    const text = [
      'Posição consolidada',
      'Posição em 31/07/2026',
      '',
      'Renda Fixa',
      'Produto;Emissor;Valor bruto',
      'CDB Banco X;Banco X;1.000,00',
      '',
      'Renda Variável',
      'Ativo;Quantidade;Valor de mercado',
      'PETR4;100;3.500,00',
      'MXRF11;50;5.000,00',
    ].join('\n');

    const { positions, referenceDate, errors } = parseXpPosition(text);

    expect(errors).toEqual([]);
    expect(referenceDate).toBe('2026-07-31');
    expect(positions.map((position) => [position.name, position.type])).toEqual([
      ['CDB Banco X', 'cdb'],
      ['PETR4', 'acao'],
      ['MXRF11', 'fii'],
    ]);
  });

  it('sums a product listed twice instead of creating a twin asset', () => {
    const { positions } = parseXpPosition(
      positionFile(
        'CDB Banco X;Banco X;CDI;110;15/03/2028;1.000,00',
        'CDB Banco X;Banco X;CDI;110;15/03/2028;500,00',
      ),
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]?.grossValueCents).toBe(150_000n);
  });

  it('skips section titles and total rows without reporting them', () => {
    const { positions, errors } = parseXpPosition(
      positionFile(
        'Renda Fixa;;;;;',
        'CDB Banco X;Banco X;CDI;110;15/03/2028;1.000,00',
        'Total;;;;;1.000,00',
      ),
    );

    expect(errors).toEqual([]);
    expect(positions.map((position) => position.name)).toEqual(['CDB Banco X']);
  });

  it('collects a bad value as a row error and imports the rest', () => {
    const { positions, errors } = parseXpPosition(
      positionFile('CDB Banco X;Banco X;;;;abc', 'LCI Banco Y;Banco Y;;;;2.000,00'),
    );

    expect(positions.map((position) => position.name)).toEqual(['LCI Banco Y']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 2, message: expect.stringContaining('abc') });
  });

  it('throws with the columns it saw when no header is recognizable', () => {
    expect(() => parseXpPosition('coluna a;coluna b\n1;2')).toThrow(XpPositionFormatError);
    expect(() => parseXpPosition('coluna a;coluna b\n1;2')).toThrow(/coluna a, coluna b/);
  });

  it('rejects an empty file', () => {
    expect(() => parseXpPosition('')).toThrow(XpPositionFormatError);
  });

  it('tolerates a label carrying its unit', () => {
    const { positions } = parseXpPosition(
      ['Produto;Valor bruto (R$)', 'CDB Banco X;1.000,00'].join('\n'),
    );

    expect(positions[0]?.grossValueCents).toBe(100_000n);
  });
});

describe('parseXpPosition, posição detalhada (.xlsx)', () => {
  const file = detailedFile(
    ...DETAILED_SUMMARY,
    ...TESOURO_TABLE,
    ...RENDA_FIXA_TABLE,
    ['Dividendos, proventos e outras distribuições'],
    ['Proventos'],
    ...PROVENTOS_TABLE,
  );

  it('reads a header that never names its product column', () => {
    const { positions, errors } = parseXpPosition(file);

    expect(errors).toEqual([]);
    expect(positions.map((position) => position.name)).toEqual([
      'LTN jan/2027',
      'NTN-B ago/2030',
      'CDB BANCO VOLKSWAGEN - SET/2026',
    ]);
  });

  it('takes the gross position, not the value already net of income tax', () => {
    const { positions } = parseXpPosition(file);
    const cdb = positions.find((position) => position.name.startsWith('CDB'));

    // "Posição a mercado", not the "Valor Líquido" of R$ 12.200,77 in the same row.
    expect(cdb?.grossValueCents).toBe(1_250_096n);
  });

  it('keeps the applied value in view without turning it into a contribution', () => {
    const { positions } = parseXpPosition(file);

    expect(positions[0]).toMatchObject({
      name: 'LTN jan/2027',
      grossValueCents: 1_334_116n,
      appliedValueCents: 1_055_365n,
    });
  });

  it('indexes a row from its rate, or from the sub-class when the row has no rate', () => {
    const { positions } = parseXpPosition(file);

    expect(positions.map((position) => [position.name, position.indexer, position.rate])).toEqual([
      // The tesouro table states no rate at all: "Prefixado" comes from the table header.
      ['LTN jan/2027', 'prefixado', null],
      ['NTN-B ago/2030', 'ipca', null],
      ['CDB BANCO VOLKSWAGEN - SET/2026', 'cdi', 100.25],
    ]);
  });

  it('reads XP\'s "IPC-A" as the IPCA indexer', () => {
    const { positions } = parseXpPosition(
      detailedFile(
        ['22,1% | Inflação', 'Posição a mercado', 'Taxa a mercado', 'Data vencimento'],
        ['NTN-B - AGO/2026', 'R$ 9.760,75', 'IPC-A +13,37%', '15/08/2026'],
      ),
    );

    expect(positions[0]).toMatchObject({
      indexer: 'ipca',
      rate: 13.37,
      maturityDate: '2026-08-15',
    });
  });

  it('drops the class title rows instead of buying the whole class as one asset', () => {
    const { positions } = parseXpPosition(file);

    // "Renda Fixa | … | R$ 12.500,96" is the sum of the table under it, not a product.
    expect(positions.map((position) => position.name)).not.toContain('Renda Fixa');
    expect(positions.map((position) => position.name)).not.toContain('Tesouro Direto');
  });

  it('leaves provisioned dividends out and says how much it left out', () => {
    const { positions, notes } = parseXpPosition(file);

    // The shares themselves are already valued elsewhere; a provento would invent an asset.
    expect(positions.map((position) => position.name)).not.toContain('EMBJ3');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ amountCents: 29_606n });
    expect(notes[0]?.message).toContain('proventos provisionados');
  });

  it("never reads a dividend row with the previous table's columns", () => {
    const { positions, errors } = parseXpPosition(file);

    // The "Provisionado" column holds a share count. Under the last position header it would
    // land in the value column and make EMBJ3 an asset worth R$ 50,00.
    expect(positions.every((position) => position.grossValueCents !== 5_000n)).toBe(true);
    expect(errors).toEqual([]);
  });

  it('reports the cash balance without importing it as an asset', () => {
    const { notes } = parseXpPosition(file);

    expect(notes[1]).toMatchObject({ amountCents: 1_416n });
    expect(notes[1]?.message).toContain('Saldo disponível');
  });

  it('accounts for every cent the file claims for itself', () => {
    const { positions, statedTotalCents, skippedCents } = parseXpPosition(file);

    const imported = positions.reduce((total, position) => total + position.grossValueCents, 0n);

    expect(statedTotalCents).toBe(2_618_367n);
    expect(imported + skippedCents).toBe(statedTotalCents);
  });

  it('does not mistake a table column for the portfolio total', () => {
    // "Total aplicado" is a column of the tesouro table; only the preamble states a total.
    const { statedTotalCents } = parseXpPosition(detailedFile(...TESOURO_TABLE));

    expect(statedTotalCents).toBeNull();
  });

  it('states no reference date, because the detailed export prints none', () => {
    const { referenceDate } = parseXpPosition(file);

    expect(referenceDate).toBeNull();
  });
});
