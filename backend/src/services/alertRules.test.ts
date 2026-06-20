import { describe, it, expect } from 'vitest';
import { passesAlertRules } from './alertRules';

// 2026-06-20 is a Saturday (UTC).
const SAT = new Date('2026-06-20T12:00:00Z');
const MON = new Date('2026-06-22T12:00:00Z');

describe('passesAlertRules', () => {
  it('passes when there are no rules', () => {
    expect(passesAlertRules({}, { price: 999 })).toBe(true);
  });

  it('blocks a price above the ceiling', () => {
    expect(passesAlertRules({ alertMaxPrice: 100 }, { price: 120 })).toBe(false);
    expect(passesAlertRules({ alertMaxPrice: 100 }, { price: 100 })).toBe(true);
    expect(passesAlertRules({ alertMaxPrice: 100 }, { price: 80 })).toBe(true);
  });

  it('is forgiving when the price is unknown', () => {
    expect(passesAlertRules({ alertMaxPrice: 100 }, { price: null })).toBe(true);
    expect(passesAlertRules({ alertMaxPrice: 100 }, {})).toBe(true);
  });

  it('restricts to allowed weekdays in the user timezone', () => {
    // Allow weekends only (Sun=0, Sat=6).
    const weekends = { alertDays: [0, 6] };
    expect(passesAlertRules(weekends, { now: SAT, timezone: 'UTC' })).toBe(true);
    expect(passesAlertRules(weekends, { now: MON, timezone: 'UTC' })).toBe(false);
  });

  it('treats an empty day list as no restriction', () => {
    expect(passesAlertRules({ alertDays: [] }, { now: MON, timezone: 'UTC' })).toBe(true);
  });

  it('applies price and day rules together', () => {
    const rules = { alertMaxPrice: 50, alertDays: [0, 6] };
    expect(passesAlertRules(rules, { price: 40, now: SAT, timezone: 'UTC' })).toBe(true);
    expect(passesAlertRules(rules, { price: 60, now: SAT, timezone: 'UTC' })).toBe(false); // price fails
    expect(passesAlertRules(rules, { price: 40, now: MON, timezone: 'UTC' })).toBe(false); // day fails
  });

  it('suppresses alerts while muted, allows after the mute expires', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    expect(passesAlertRules({ mutedUntil: future }, {})).toBe(false);
    expect(passesAlertRules({ mutedUntil: past }, {})).toBe(true);
    expect(passesAlertRules({ mutedUntil: null }, {})).toBe(true);
    // A mute overrides an otherwise-passing rule set.
    expect(passesAlertRules({ mutedUntil: future, alertMaxPrice: 100 }, { price: 50 })).toBe(false);
  });

  it('honors timezone when picking the local weekday', () => {
    // 2026-06-22T01:00Z is still Sunday in New York (prev day).
    const lateSun = new Date('2026-06-22T01:00:00Z');
    expect(passesAlertRules({ alertDays: [0] }, { now: lateSun, timezone: 'America/New_York' })).toBe(true);
    expect(passesAlertRules({ alertDays: [0] }, { now: lateSun, timezone: 'UTC' })).toBe(false); // Monday in UTC
  });
});
