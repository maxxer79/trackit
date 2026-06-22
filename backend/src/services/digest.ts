/**
 * Pure helpers for the daily/weekly digest email. Scheduling math and the
 * grouping of a user's recent alerts into ordered sections live here (no DB /
 * IO) so they're deterministic and unit-testable. The worker + email HTML live
 * in workers/digest.ts and services/email.ts respectively.
 */

export type DigestFrequency = 'off' | 'daily' | 'weekly';

export function normalizeFrequency(v: unknown): DigestFrequency {
  return v === 'daily' || v === 'weekly' ? v : 'off';
}

/** Days of history a given cadence summarizes. */
export function windowDays(freq: DigestFrequency): number {
  return freq === 'weekly' ? 7 : 1;
}

/**
 * Should a digest of this cadence be sent on this run? The worker fires daily;
 * 'daily' sends every day, 'weekly' only on Mondays, 'off' never. Uses the
 * server-local weekday (Mon = 1) — good enough for a single-tenant home lab.
 */
export function shouldRunForFrequency(freq: DigestFrequency, now: Date = new Date()): boolean {
  if (freq === 'daily') return true;
  if (freq === 'weekly') return now.getDay() === 1; // Monday
  return false;
}

export interface DigestAlert {
  type: string; // AlertType: IN_STOCK | PRICE_DROP | LOW_STOCK | PICKUP | PRICE_TARGET
  productName: string;
  productSlug?: string | null;
  storeName?: string | null;
  price?: number | null;
  productUrl?: string | null;
  sentAt: Date | string;
}

export interface DigestSectionItem {
  productName: string;
  productSlug?: string | null;
  storeName?: string | null;
  price?: number | null;
  productUrl?: string | null;
}
export interface DigestSection {
  type: string;
  label: string;
  emoji: string;
  items: DigestSectionItem[];
}

// Display order + labels. Restocks first (most actionable), then price events,
// then pickup / low-stock. Anything unmapped falls under a generic bucket.
const SECTION_META: { type: string; label: string; emoji: string }[] = [
  { type: 'IN_STOCK', label: 'Back in stock', emoji: '🟢' },
  { type: 'PRICE_TARGET', label: 'Hit your price target', emoji: '🎯' },
  { type: 'PRICE_DROP', label: 'Price drops', emoji: '💸' },
  { type: 'PICKUP', label: 'Ready for in-store pickup', emoji: '🏪' },
  { type: 'LOW_STOCK', label: 'Running low', emoji: '⚠️' },
];

/**
 * Group a user's alerts into ordered sections, newest-first within each. Empty
 * sections are dropped. Returns `{ sections, total }`.
 */
export function groupDigestAlerts(alerts: DigestAlert[]): { sections: DigestSection[]; total: number } {
  const byType = new Map<string, DigestAlert[]>();
  for (const a of alerts) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }

  const sections: DigestSection[] = [];
  const seen = new Set<string>();

  const toItem = (a: DigestAlert): DigestSectionItem => ({
    productName: a.productName,
    productSlug: a.productSlug ?? null,
    storeName: a.storeName ?? null,
    price: a.price ?? null,
    productUrl: a.productUrl ?? null,
  });
  const byNewest = (a: DigestAlert, b: DigestAlert) =>
    new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();

  for (const meta of SECTION_META) {
    const list = byType.get(meta.type);
    if (list && list.length) {
      sections.push({ ...meta, items: [...list].sort(byNewest).map(toItem) });
      seen.add(meta.type);
    }
  }
  // Any alert types we didn't explicitly map → one "Other updates" section.
  const leftovers: DigestAlert[] = [];
  for (const [type, list] of byType) {
    if (!seen.has(type)) leftovers.push(...list);
  }
  if (leftovers.length) {
    sections.push({ type: 'OTHER', label: 'Other updates', emoji: '🔔', items: [...leftovers].sort(byNewest).map(toItem) });
  }

  return { sections, total: alerts.length };
}
