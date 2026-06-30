import axios from 'axios';

/**
 * Home Assistant integration — posts to HA's built-in webhook trigger
 * (Settings → Automations → Webhook, URL shape
 * `http://<ha-host>:8123/api/webhook/<webhook_id>`). HA's `webhook` automation
 * trigger exposes the POST body as `trigger.json` in templates, so unlike the
 * Discord channel (which sends a pre-formatted embed for humans to read) this
 * sends a flat, predictable JSON object meant to be consumed by the user's own
 * automation — e.g. flash a light on RESTOCK, announce a PRICE_TARGET hit via
 * TTS. No HA auth token is needed; the webhook ID itself is the secret.
 */
interface HomeAssistantPayload {
  webhookUrl: string;
  productName: string;
  productSlug: string;
  storeName: string;
  productUrl: string;
  price?: number | null;
  status: string;
  kind?: 'RESTOCK' | 'PRICE_DROP' | 'LOW_STOCK' | 'PICKUP' | 'PRICE_TARGET';
  previousPrice?: number | null;
  targetPrice?: number | null;
  pickupLocation?: string | null;
}

export async function sendHomeAssistantEvent(payload: HomeAssistantPayload): Promise<void> {
  const {
    webhookUrl, productName, productSlug, storeName, productUrl,
    price, status, kind, previousPrice, targetPrice, pickupLocation,
  } = payload;

  if (!webhookUrl) return;

  await axios.post(webhookUrl, {
    event: 'trackit_alert',
    kind: kind ?? 'RESTOCK',
    productName,
    productSlug,
    storeName,
    productUrl,
    status,
    price: price ?? null,
    previousPrice: previousPrice ?? null,
    targetPrice: targetPrice ?? null,
    pickupLocation: pickupLocation ?? null,
    timestamp: new Date().toISOString(),
  });
}
