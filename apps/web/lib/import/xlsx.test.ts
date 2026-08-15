import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { XlsxFormatError, isXlsx, xlsxToDelimitedText } from './xlsx';

/**
 * Builds a workbook by hand instead of committing a fixture: the sample export the parser was
 * written against is real financial data and stays out of the repo (.gitignore), so the tests
 * carry the *shape* of that file rather than the file.
 */
function workbook(parts: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];

  for (const [name, content] of Object.entries(parts)) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(content);
    const deflated = deflateRawSync(raw);
    const offset = local.length;

    local.push(
      ...word(0x0403_4b50),
      ...half(20),
      ...half(0),
      ...half(8),
      ...half(0),
      ...half(0),
      ...word(crc32(raw)),
      ...word(deflated.length),
      ...word(raw.length),
      ...half(nameBytes.length),
      ...half(0),
      ...nameBytes,
      ...deflated,
    );

    central.push(
      ...word(0x0201_4b50),
      ...half(20),
      ...half(20),
      ...half(0),
      ...half(8),
      ...half(0),
      ...half(0),
      ...word(crc32(raw)),
      ...word(deflated.length),
      ...word(raw.length),
      ...half(nameBytes.length),
      ...half(0),
      ...half(0),
      ...half(0),
      ...half(0),
      ...word(0),
      ...word(offset),
      ...nameBytes,
    );
  }

  return new Uint8Array([
    ...local,
    ...central,
    ...word(0x0605_4b50),
    ...half(0),
    ...half(0),
    ...half(Object.keys(parts).length),
    ...half(Object.keys(parts).length),
    ...word(central.length),
    ...word(local.length),
    ...half(0),
  ]);
}

function half(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function word(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** The parts a real export has, with the sheet body and shared strings filled in per test. */
function sheet(strings: string[], rows: string, extra: Record<string, string> = {}) {
  return workbook({
    'xl/workbook.xml':
      '<workbook><sheets><sheet name="Sua carteira" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${strings.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    ...extra,
  });
}

describe('isXlsx', () => {
  it('recognizes the container by its bytes, not by the extension', () => {
    expect(isXlsx(sheet(['a'], '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'))).toBe(true);
    expect(isXlsx(new TextEncoder().encode('produto;valor bruto'))).toBe(false);
  });
});

describe('xlsxToDelimitedText', () => {
  it('reads shared strings into rows of text', () => {
    const bytes = sheet(
      ['Produto', 'Valor bruto', 'CDB Banco X', 'R$ 1.000,00'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>',
    );

    expect(xlsxToDelimitedText(bytes).text).toBe('Produto,Valor bruto\nCDB Banco X,"R$ 1.000,00"');
  });

  it('keeps a cell in its own column when the row skips the ones before it', () => {
    // XP writes the class total in the last column and leaves the middle empty; appending
    // cells in document order would slide it left, into the column holding position values.
    const bytes = sheet(
      ['Renda Fixa', 'R$ 61.340,71'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"/><c r="C1"/><c r="G1" t="s"><v>1</v></c></row>',
    );

    expect(xlsxToDelimitedText(bytes).text).toBe('Renda Fixa,,,,,,"R$ 61.340,71"');
  });

  it('renders a date-formatted number as the date it shows, not as a serial', () => {
    const bytes = sheet(
      ['Vencimento'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>46249</v></c></row>',
      {
        'xl/styles.xml':
          '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      },
    );

    expect(xlsxToDelimitedText(bytes).text).toBe('Vencimento,15/08/2026');
  });

  it('leaves a plain number alone', () => {
    const bytes = sheet(
      ['Quantidade'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>14</v></c></row>',
    );

    expect(xlsxToDelimitedText(bytes).text).toBe('Quantidade,14');
  });

  it('reads the export date in the app timezone', () => {
    // 00:02 UTC is still the previous day in São Paulo, which is the day the user exported.
    const bytes = sheet(['Produto'], '<row r="1"><c r="A1" t="s"><v>0</v></c></row>', {
      'docProps/core.xml':
        '<coreProperties><dcterms:created>2026-08-15T00:02:44Z</dcterms:created></coreProperties>',
    });

    expect(xlsxToDelimitedText(bytes).exportedOn).toBe('2026-08-14');
  });

  it('reports no export date when the workbook does not carry one', () => {
    const bytes = sheet(['Produto'], '<row r="1"><c r="A1" t="s"><v>0</v></c></row>');

    expect(xlsxToDelimitedText(bytes).exportedOn).toBeNull();
  });

  it('rejects something that is not a workbook', () => {
    expect(() => xlsxToDelimitedText(new TextEncoder().encode('produto;valor'))).toThrow(
      XlsxFormatError,
    );
  });

  it('rejects a workbook with no rows', () => {
    expect(() => xlsxToDelimitedText(sheet([], ''))).toThrow(XlsxFormatError);
  });
});
