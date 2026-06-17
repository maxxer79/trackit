import { describe, it, expect } from 'vitest';
import { minutesInTimeZone, isWithinWindow, isQuietNow } from './quietHours';

const NOON_UTC = new Date('2026-06-17T12:00:00Z'); // June → US daylight time

describe('minutesInTimeZone', () => {
  it('converts a UTC instant into local minutes-from-midnight', () => {
    expect(minutesInTimeZone(NOON_UTC, 'UTC')).toBe(12 * 60);
    expect(minutesInTimeZone(NOON_UTC, 'America/New_York')).toBe(8 * 60); // EDT, UTC-4
    expect(minutesInTimeZone(NOON_UTC, 'Asia/Tokyo')).toBe(21 * 60); // UTC+9
  });
});

describe('isWithinWindow', () => {
  it('handles a normal daytime window [09:00, 17:00)', () => {
    expect(isWithinWindow(10 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(isWithinWindow(8 * 60, 9 * 60, 17 * 60)).toBe(false);
    expect(isWithinWindow(17 * 60, 9 * 60, 17 * 60)).toBe(false); // end exclusive
  });

  it('handles an overnight window [22:00, 07:00)', () => {
    expect(isWithinWindow(23 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinWindow(1 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinWindow(7 * 60, 22 * 60, 7 * 60)).toBe(false);
    expect(isWithinWindow(12 * 60, 22 * 60, 7 * 60)).toBe(false);
  });

  it('treats an equal start/end as empty', () => {
    expect(isWithinWindow(600, 600, 600)).toBe(false);
  });
});

describe('isQuietNow', () => {
  const base = { quietHoursStart: 22 * 60, quietHoursEnd: 7 * 60, timezone: 'America/New_York' };

  it('is false when disabled or unset', () => {
    expect(isQuietNow({ ...base, quietHoursEnabled: false }, NOON_UTC)).toBe(false);
    expect(isQuietNow({ quietHoursEnabled: true, quietHoursStart: null, quietHoursEnd: null, timezone: 'UTC' }, NOON_UTC)).toBe(false);
  });

  it('respects the user timezone for an overnight window', () => {
    // 12:00 UTC = 08:00 in NY → outside 22:00–07:00 window.
    expect(isQuietNow({ ...base, quietHoursEnabled: true }, NOON_UTC)).toBe(false);
    // 03:00 UTC = 23:00 prior day in NY → inside the window.
    const lateUtc = new Date('2026-06-17T03:00:00Z');
    expect(isQuietNow({ ...base, quietHoursEnabled: true }, lateUtc)).toBe(true);
  });

  it('falls back to UTC on an invalid timezone', () => {
    // 23:30 UTC, window 22:00–07:00, bogus tz → uses UTC → quiet.
    const lateUtc = new Date('2026-06-17T23:30:00Z');
    expect(isQuietNow({ quietHoursEnabled: true, quietHoursStart: 22 * 60, quietHoursEnd: 7 * 60, timezone: 'Not/AZone' }, lateUtc)).toBe(true);
  });
});
