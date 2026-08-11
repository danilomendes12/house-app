import { describe, expect, it } from 'vitest';
import { detectDelimiter, normalizeText, parseDelimited } from './csv';

describe('detectDelimiter', () => {
  it('defaults to a comma', () => {
    expect(detectDelimiter('date,title,amount\n2026-08-01,Café,12.50')).toBe(',');
  });

  it('picks the semicolon used by pt-BR exports', () => {
    expect(detectDelimiter('data;título;valor\n01/08/2026;Café;12,50')).toBe(';');
  });

  it('only looks at the header, not at commas inside values', () => {
    expect(detectDelimiter('data;valor\nMercado, centro;1.234,56')).toBe(';');
  });
});

describe('parseDelimited', () => {
  it('reads a plain file', () => {
    expect(parseDelimited('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles CRLF and a trailing newline', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM from the first header cell', () => {
    expect(parseDelimited('﻿date,title')[0]).toEqual(['date', 'title']);
  });

  it('keeps delimiters and newlines inside quoted fields', () => {
    expect(parseDelimited('a,b\n"Mercado, centro","linha 1\nlinha 2"')[1]).toEqual([
      'Mercado, centro',
      'linha 1\nlinha 2',
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseDelimited('a\n"Loja ""X"""')[1]).toEqual(['Loja "X"']);
  });

  it('drops blank lines', () => {
    expect(parseDelimited('a,b\n\n1,2\n   \n')).toHaveLength(2);
  });

  it('keeps empty cells that carry position', () => {
    expect(parseDelimited('a,b,c\n1,,3')[1]).toEqual(['1', '', '3']);
  });
});

describe('normalizeText', () => {
  it('lowercases, strips accents and collapses whitespace', () => {
    expect(normalizeText('  Padaria   São   JOÃO ')).toBe('padaria sao joao');
  });

  it('is idempotent', () => {
    expect(normalizeText(normalizeText('Título'))).toBe('titulo');
  });
});
