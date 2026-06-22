import { describe, it, expect } from 'vitest';
import { normalizeFrequency, windowDays, shouldRunForFrequency, groupDigestAlerts } from './digest';

describe('normalizeFrequency', () => {
  it('accepts daily/weekly, coerces everything else to off', () => {
    expect(normalizeFrequency('daily')).toBe('daily');
    expect(normalizeFrequency('weekly')).toBe('weekly');
    expect(normalizeFrequency('off')).toBe('off');
    expect(normalizeFrequency('nonsense')).toBe('off');
    expect(normalizeFrequency(undefined)).toBe('off');
  });
});

describe('windowDays', () => {
  it('is 1 for daily and 7 for weekly', () => {
    expect(windowDays('daily')).toBe(1);
    expect(windowDays('weekly')).toBe(7);
    expect(windowDays('off')).toBe(1);
  });
});

describe('shouldRunForFrequency', () => {
  const monday = new Date(2026, 5, 22); // Jun 22 2026 is a Monday
  const tuesday = new Date(2026, 5, 23);
  it('daily runs every day', () => {
    expect(shouldRunForFrequency('daily', monday)).toBe(true);
    expect(shouldRunForFrequency('daily', tuesday)).toBe(true);
  });
  it('weekly runs only on Monday', () => {
    expect(shouldRunForFrequency('weekly', monday)).toBe(true);
    expect(shouldRunForFrequency('weekly', tuesday)).toBe(false);
  });
  it('off never runs', () => {
    expect(shouldRunForFrequency('off', monday)).toBe(false);
  });
});

describe('groupDigestAlerts', () => {
  const a = (type: string, name: string, sentAt: string) => ({ type, productName: name, sentAt });

  it('returns no sections for no alerts', () => {
    const { sections, total } = groupDigestAlerts([]);
    expect(sections).toEqual([]);
    expect(total).toBe(0);
  });

  it('orders sections restocks → target → drop → pickup → low, dropping empties', () => {
    const { sections, total } = groupDigestAlerts([
      a('LOW_STOCK', 'L', '2026-06-01'),
      a('IN_STOCK', 'R', '2026-06-02'),
      a('PRICE_DROP', 'D', '2026-06-03'),
      a('PRICE_TARGET', 'T', '2026-06-04'),
    ]);
    expect(sections.map((s) => s.type)).toEqual(['IN_STOCK', 'PRICE_TARGET', 'PRICE_DROP', 'LOW_STOCK']);
    expect(total).toBe(4);
  });

  it('sorts items newest-first within a section', () => {
    const { sections } = groupDigestAlerts([
      a('IN_STOCK', 'older', '2026-06-01'),
      a('IN_STOCK', 'newer', '2026-06-05'),
    ]);
    expect(sections[0].items.map((i) => i.productName)).toEqual(['newer', 'older']);
  });

  it('buckets unmapped alert types under Other updates', () => {
    const { sections } = groupDigestAlerts([a('WEIRD_TYPE', 'X', '2026-06-01')]);
    expect(sections[0].type).toBe('OTHER');
    expect(sections[0].label).toBe('Other updates');
  });
});
