import { describe, it, expect } from 'vitest';
import { shouldNotifyPickup, isValidUsZip, normalizeZip } from './pickup';

describe('shouldNotifyPickup', () => {
  it('fires only on a confirmed-unavailable → available transition', () => {
    expect(shouldNotifyPickup(false, true)).toBe(true);
  });
  it('does not fire on the first-ever observation (null → true)', () => {
    expect(shouldNotifyPickup(null, true)).toBe(false);
    expect(shouldNotifyPickup(undefined, true)).toBe(false);
  });
  it('does not fire when pickup stays available', () => {
    expect(shouldNotifyPickup(true, true)).toBe(false);
  });
  it('does not fire when pickup goes away or stays unavailable', () => {
    expect(shouldNotifyPickup(true, false)).toBe(false);
    expect(shouldNotifyPickup(false, false)).toBe(false);
  });
  it('does not fire when the new reading is unknown', () => {
    expect(shouldNotifyPickup(false, null)).toBe(false);
    expect(shouldNotifyPickup(true, undefined)).toBe(false);
  });
});

describe('isValidUsZip', () => {
  it('accepts a 5-digit ZIP and ZIP+4', () => {
    expect(isValidUsZip('94117')).toBe(true);
    expect(isValidUsZip('94117-1234')).toBe(true);
    expect(isValidUsZip(' 30301 ')).toBe(true); // trimmed
  });
  it('rejects junk, partials, and empty', () => {
    expect(isValidUsZip('')).toBe(false);
    expect(isValidUsZip(null)).toBe(false);
    expect(isValidUsZip('abcde')).toBe(false);
    expect(isValidUsZip('1234')).toBe(false);
    expect(isValidUsZip('123456')).toBe(false);
  });
});

describe('normalizeZip', () => {
  it('returns a trimmed valid zip', () => {
    expect(normalizeZip(' 94117 ')).toBe('94117');
  });
  it('returns null for blank or invalid input', () => {
    expect(normalizeZip('')).toBeNull();
    expect(normalizeZip(null)).toBeNull();
    expect(normalizeZip('nope')).toBeNull();
  });
});
