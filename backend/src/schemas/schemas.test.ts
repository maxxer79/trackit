import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  addTrackingSchema,
  createCommentSchema,
  updatePreferencesSchema,
  addStoreProductSchema,
  updateStockSchema,
  createAdminUserSchema,
} from './index';

describe('registerSchema', () => {
  it('accepts a valid registration and trims the name', () => {
    const r = registerSchema.parse({ email: 'a@b.com', password: 'longenough', name: '  Rob  ' });
    expect(r.name).toBe('Rob');
  });
  it('rejects a malformed email', () => {
    expect(registerSchema.safeParse({ email: 'nope', password: 'longenough', name: 'Rob' }).success).toBe(false);
  });
  it('rejects a password under 8 chars', () => {
    expect(registerSchema.safeParse({ email: 'a@b.com', password: 'short', name: 'Rob' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('requires a non-empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('updatePreferencesSchema', () => {
  it('accepts null phone and null discordWebhook (the unset-default round-trip)', () => {
    const r = updatePreferencesSchema.parse({ emailEnabled: true, phone: null, discordWebhook: null });
    expect(r.phone).toBeNull();
    expect(r.discordWebhook).toBeNull();
  });
  it('accepts a valid webhook URL and an empty string', () => {
    expect(updatePreferencesSchema.safeParse({ discordWebhook: 'https://discord.com/api/webhooks/x' }).success).toBe(true);
    expect(updatePreferencesSchema.safeParse({ discordWebhook: '' }).success).toBe(true);
  });
  it('rejects a malformed webhook URL', () => {
    expect(updatePreferencesSchema.safeParse({ discordWebhook: 'not a url' }).success).toBe(false);
  });

  // Regression: pickupEnabled/pickupZip/digestFrequency were missing from this
  // schema, and validate() strips any key not declared here — so Settings →
  // Pickup and Settings → Digest saves were silently discarded before ever
  // reaching the controller. These three checks pin that fix.
  it('round-trips pickupEnabled, pickupZip, and digestFrequency instead of stripping them', () => {
    const r = updatePreferencesSchema.parse({ pickupEnabled: true, pickupZip: '55401', digestFrequency: 'weekly' });
    expect(r.pickupEnabled).toBe(true);
    expect(r.pickupZip).toBe('55401');
    expect(r.digestFrequency).toBe('weekly');
  });
  it('accepts a null pickupZip (clearing it)', () => {
    expect(updatePreferencesSchema.parse({ pickupZip: null }).pickupZip).toBeNull();
  });
  it('rejects an invalid digestFrequency value', () => {
    expect(updatePreferencesSchema.safeParse({ digestFrequency: 'hourly' }).success).toBe(false);
  });

  it('round-trips the Home Assistant webhook channel', () => {
    const r = updatePreferencesSchema.parse({
      homeAssistantEnabled: true,
      homeAssistantWebhook: 'http://homeassistant.local:8123/api/webhook/abc123',
    });
    expect(r.homeAssistantEnabled).toBe(true);
    expect(r.homeAssistantWebhook).toContain('/api/webhook/');
  });
  it('accepts null/empty homeAssistantWebhook and rejects a malformed one', () => {
    expect(updatePreferencesSchema.safeParse({ homeAssistantWebhook: null }).success).toBe(true);
    expect(updatePreferencesSchema.safeParse({ homeAssistantWebhook: '' }).success).toBe(true);
    expect(updatePreferencesSchema.safeParse({ homeAssistantWebhook: 'not a url' }).success).toBe(false);
  });
});

describe('addTrackingSchema', () => {
  it('requires productId and preserves watchStores', () => {
    expect(addTrackingSchema.safeParse({}).success).toBe(false);
    const r = addTrackingSchema.parse({ productId: 'p1', watchStores: ['amazon'] });
    expect(r.watchStores).toEqual(['amazon']);
  });
});

describe('createCommentSchema', () => {
  it('trims, and rejects empty or over-long bodies', () => {
    expect(createCommentSchema.parse({ body: '  hi  ' }).body).toBe('hi');
    expect(createCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('addStoreProductSchema', () => {
  it('requires a well-formed product URL (with scheme)', () => {
    expect(addStoreProductSchema.safeParse({ productId: 'p', storeId: 's', url: 'amazon.com/x' }).success).toBe(false);
    expect(addStoreProductSchema.safeParse({ productId: 'p', storeId: 's', url: 'https://amazon.com/x' }).success).toBe(true);
  });
  it('rejects a missing storeId', () => {
    expect(addStoreProductSchema.safeParse({ productId: 'p', url: 'https://x.com' }).success).toBe(false);
  });
});

describe('createAdminUserSchema', () => {
  it('coerces a string trackingLimit to a number (createForm sends "10")', () => {
    const r = createAdminUserSchema.parse({
      name: 'Rob', email: 'a@b.com', password: 'longenough', role: 'USER', trackingLimit: '10',
    });
    expect(r.trackingLimit).toBe(10);
  });
  it('rejects an invalid role', () => {
    expect(createAdminUserSchema.safeParse({
      name: 'Rob', email: 'a@b.com', password: 'longenough', role: 'SUPER',
    }).success).toBe(false);
  });
});

describe('updateStockSchema', () => {
  it('accepts a valid stockStatus enum and a partial body', () => {
    expect(updateStockSchema.safeParse({ inStock: true }).success).toBe(true);
    expect(updateStockSchema.safeParse({ stockStatus: 'PREORDER' }).success).toBe(true);
  });
  it('rejects an unknown stockStatus', () => {
    expect(updateStockSchema.safeParse({ stockStatus: 'SOON' }).success).toBe(false);
  });
});
