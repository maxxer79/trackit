import { describe, it, expect } from 'vitest';
import { carrierTrackingUrl, mapShip24Milestone, ship24CourierCode } from './carriers';

describe('mapShip24Milestone', () => {
  it('maps known milestones to our statuses', () => {
    expect(mapShip24Milestone('info_received')).toBe('ORDERED');
    expect(mapShip24Milestone('pending')).toBe('ORDERED');
    expect(mapShip24Milestone('in_transit')).toBe('SHIPPED');
    expect(mapShip24Milestone('out_for_delivery')).toBe('OUT_FOR_DELIVERY');
    expect(mapShip24Milestone('available_for_pickup')).toBe('OUT_FOR_DELIVERY');
    expect(mapShip24Milestone('failed_attempt')).toBe('OUT_FOR_DELIVERY');
    expect(mapShip24Milestone('delivered')).toBe('DELIVERED');
  });
  it('returns null for unmapped/exception milestones', () => {
    expect(mapShip24Milestone('exception')).toBeNull();
    expect(mapShip24Milestone('')).toBeNull();
    expect(mapShip24Milestone(null)).toBeNull();
    expect(mapShip24Milestone('nonsense')).toBeNull();
  });
});

describe('ship24CourierCode', () => {
  it('returns codes for the big four, null otherwise', () => {
    expect(ship24CourierCode('ups')).toBe('ups');
    expect(ship24CourierCode('FedEx')).toBe('fedex');
    expect(ship24CourierCode('amazon')).toBeNull();
    expect(ship24CourierCode('other')).toBeNull();
    expect(ship24CourierCode(null)).toBeNull();
  });
});

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
