/**
 * Minimal, dependency-free CSV builder. RFC-4180-ish: fields containing a comma,
 * quote, newline, or surrounding whitespace are double-quoted and inner quotes
 * are doubled. CRLF row endings (Excel-friendly).
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(','));
  return [header, ...body].join('\r\n');
}
