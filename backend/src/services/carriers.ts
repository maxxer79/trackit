/**
 * Carrier metadata + tracking-URL builder for manual delivery tracking. We don't
 * call carrier APIs — we just link the user straight to the carrier's own
 * tracking page for the number they entered. Pure + unit-testable.
 */

export type CarrierId = 'ups' | 'usps' | 'fedex' | 'dhl' | 'amazon' | 'other';

export const CARRIERS: { id: CarrierId; name: string }[] = [
  { id: 'ups', name: 'UPS' },
  { id: 'usps', name: 'USPS' },
  { id: 'fedex', name: 'FedEx' },
  { id: 'dhl', name: 'DHL' },
  { id: 'amazon', name: 'Amazon' },
  { id: 'other', name: 'Other' },
];

export const PURCHASE_STATUSES = [
  'ORDERED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

// Ship24 courier codes for the carriers we expose. Providing one helps Ship24
// resolve the right shipment; null lets Ship24 auto-detect.
export function ship24CourierCode(carrier?: string | null): string | null {
  switch ((carrier ?? '').toLowerCase()) {
    case 'ups':
      return 'ups';
    case 'usps':
      return 'usps';
    case 'fedex':
      return 'fedex';
    case 'dhl':
      return 'dhl';
    default:
      return null; // amazon / other → let Ship24 detect
  }
}

// Map Ship24's high-level statusMilestone to our manual PurchaseStatus. Returns
// null for milestones we don't confidently map (e.g. 'exception'), so the
// caller leaves the user's status untouched and just records the raw milestone.
const MILESTONE_MAP: Record<string, PurchaseStatus> = {
  pending: 'ORDERED',
  info_received: 'ORDERED',
  in_transit: 'SHIPPED',
  out_for_delivery: 'OUT_FOR_DELIVERY',
  available_for_pickup: 'OUT_FOR_DELIVERY',
  failed_attempt: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
};
export function mapShip24Milestone(milestone?: string | null): PurchaseStatus | null {
  return MILESTONE_MAP[(milestone ?? '').toLowerCase()] ?? null;
}

// Amazon has no public per-number tracking URL (it lives behind the account), so
// it returns null — the UI shows the number without a link.
export function carrierTrackingUrl(carrier?: string | null, trackingNumber?: string | null): string | null {
  if (!carrier || !trackingNumber) return null;
  const n = encodeURIComponent(trackingNumber.trim());
  if (!n) return null;
  switch (carrier.toLowerCase()) {
    case 'ups':
      return `https://www.ups.com/track?tracknum=${n}`;
    case 'usps':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'fedex':
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case 'dhl':
      return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`;
    default:
      return null;
  }
}
