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
