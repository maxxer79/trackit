// Display metadata for item conditions on store listings.
export const CONDITIONS = ['NEW', 'OPEN_BOX', 'USED', 'REFURBISHED'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABEL: Record<string, string> = {
  NEW: 'New',
  OPEN_BOX: 'Open Box',
  USED: 'Used',
  REFURBISHED: 'Refurbished',
};

// Tailwind classes for a small condition pill. NEW is intentionally muted so it
// doesn't add noise on the common case.
export const CONDITION_BADGE: Record<string, string> = {
  NEW: 'text-dark-label3 border-dark-separator',
  OPEN_BOX: 'text-apple-orange border-apple-orange/30 bg-apple-orange/10',
  USED: 'text-apple-yellow border-apple-yellow/30 bg-apple-yellow/10',
  REFURBISHED: 'text-apple-purple border-apple-purple/30 bg-apple-purple/10',
};

export const conditionLabel = (c?: string | null): string => CONDITION_LABEL[c ?? 'NEW'] ?? 'New';
