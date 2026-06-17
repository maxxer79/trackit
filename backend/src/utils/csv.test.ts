import { describe, it, expect } from 'vitest';
import { escapeCsvCell, toCsv } from './csv';

describe('escapeCsvCell', () => {
  it('passes plain values through', () => {
    expect(escapeCsvCell('amazon')).toBe('amazon');
    expect(escapeCsvCell(42)).toBe('42');
  });
  it('renders null/undefined as empty', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
  it('quotes and escapes commas, quotes, newlines and surrounding spaces', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell(' padded ')).toBe('" padded "');
  });
});

describe('toCsv', () => {
  it('builds a header row and CRLF-joined escaped rows', () => {
    const rows = [
      { name: 'Widget, Deluxe', price: 9.99 },
      { name: 'Plain', price: null },
    ];
    const csv = toCsv(rows, [
      { header: 'Name', value: (r) => r.name },
      { header: 'Price', value: (r) => r.price },
    ]);
    expect(csv).toBe('Name,Price\r\n"Widget, Deluxe",9.99\r\nPlain,');
  });
});
