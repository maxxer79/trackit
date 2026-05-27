import twilio from 'twilio';

interface SmsPayload {
  to: string;
  productName: string;
  storeName: string;
  productUrl: string;
  price?: number | null;
  status: string;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'IN_STOCK': return 'IN STOCK';
    case 'LIMITED': return 'LIMITED STOCK';
    case 'PREORDER': return 'AVAILABLE FOR PREORDER';
    default: return 'AVAILABLE';
  }
}

export async function sendSmsAlert(payload: SmsPayload): Promise<void> {
  const { to, productName, storeName, productUrl, price, status } = payload;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('⚠️ Twilio credentials not configured, skipping SMS alert');
    return;
  }

  const client = twilio(accountSid, authToken);
  const priceStr = price ? ` — $${price.toFixed(2)}` : '';

  const message = [
    `🟢 TrackIt Alert`,
    `${productName} is now ${statusLabel(status)} at ${storeName}${priceStr}!`,
    `Shop: ${productUrl}`,
  ].join('\n');

  await client.messages.create({
    body: message,
    from: fromNumber,
    to,
  });
}
