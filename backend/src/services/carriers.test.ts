import { describe, it, expect } from 'vitest';
import { carrierTrackingUrl } from './carriers';

describe('carrierTrackingUrl', () => {
  it('builds known-carrier URLs with the encoded number', () => {
    expect(carrierTrackingUrl('ups', '1Z 999')).toBe('https://www.ups.com/track?tracknum=1Z%20999');
    expect(carrierTrackingUrl('usps', '9400111')).toBe('https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111');
    expect(carrierTrackingUrl('fedex', '7700')).toBe('https://www.fedex.com/fedextrack/?trknbr=7700');
    expect(carrierTrackingUrl('dhl', 'JD01')).toBe('https://www.dhl.com/us-en/home/tracking.html?tracking-id=JD01');
  });

  it('is case-insensitive on the carrier id', () => {
    expect(carrierTrackingUrl('UPS', '1Z')).toContain('ups.com');
  });

  it('returns null for Amazon and unknown carriers (no public URL)', () => {
    expect(carrierTrackingUrl('amazon', '123')).toBeNull();
    expect(carrierTrackingUrl('other', '123')).toBeNull();
    expect(carrierTrackingUrl('carrierpigeon', '123')).toBeNull();
  });

  it('returns null when carrier or number is missing/blank', () => {
    expect(carrierTrackingUrl(null, '123')).toBeNull();
    expect(carrierTrackingUrl('ups', null)).toBeNull();
    expect(carrierTrackingUrl('ups', '   ')).toBeNull();
  });
});
