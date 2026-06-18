import nodemailer from 'nodemailer';

interface EmailPayload {
  to: string;
  name: string;
  productName: string;
  storeName: string;
  productUrl: string;
  price?: number | null;
  status: string;
  kind?: 'RESTOCK' | 'PRICE_DROP' | 'LOW_STOCK';
  previousPrice?: number | null;
}

function createTransporter() {
  // Support SendGrid, SMTP, or any compatible mailer
  if (process.env.SENDGRID_API_KEY) {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function formatPrice(price?: number | null): string {
  if (!price) return '';
  return ` — $${price.toFixed(2)}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'IN_STOCK': return 'In Stock';
    case 'LIMITED': return 'Limited Stock';
    case 'PREORDER': return 'Available for Pre-order';
    default: return 'Available';
  }
}

export async function sendEmailAlert(payload: EmailPayload): Promise<void> {
  const { to, name, productName, storeName, productUrl, price, status, kind, previousPrice } = payload;

  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'alerts@trackit.app';
  const priceStr = formatPrice(price);
  const statusStr = statusLabel(status);

  const isDrop = kind === 'PRICE_DROP';
  const isLow = kind === 'LOW_STOCK';
  const subtitle = isDrop ? 'Price Drop Alert' : isLow ? 'Low Stock Alert' : 'Stock Alert Notification';
  const headline = isDrop
    ? `Good news — the price just dropped on an item you're tracking.`
    : isLow
      ? `Heads up — an item you're tracking is <strong style="color:#ff9f0a;">running low</strong>. Grab it before it sells out.`
      : `Great news! An item you're tracking is now <strong style="color:#30d158;">${statusStr}</strong>.`;
  const priceCardHtml = isDrop
    ? `<div style="font-size:24px;font-weight:700;color:#0071e3;">$${price?.toFixed(2) ?? '?'}${
        previousPrice
          ? ` <span style="font-size:15px;color:#8e8e93;font-weight:500;text-decoration:line-through;">$${previousPrice.toFixed(2)}</span>`
          : ''
      }</div>`
    : price
      ? `<div style="font-size:24px;font-weight:700;color:#0071e3;">$${price.toFixed(2)}</div>`
      : '';
  const subject = isDrop
    ? `💸 Price drop: ${productName} now $${price?.toFixed(2) ?? ''} at ${storeName}`
    : isLow
      ? `⚠️ ${productName} is running low at ${storeName}${priceStr}`
      : `🟢 ${productName} is ${statusStr} at ${storeName}${priceStr}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stock Alert — TrackIt</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0071e3,#00c6ff);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
              <div style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.5px;">TrackIt</div>
              <div style="font-size:14px;color:rgba(255,255,255,0.8);margin-top:4px;">${subtitle}</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background:#1c1c1e;padding:40px;">
              <p style="color:#ebebf5;font-size:16px;margin:0 0 8px;">Hi ${name || 'there'},</p>
              <p style="color:#ebebf5;font-size:16px;margin:0 0 28px;">
                ${headline}
              </p>

              <!-- Product Card -->
              <div style="background:#2c2c2e;border-radius:12px;padding:24px;margin-bottom:28px;">
                <div style="font-size:20px;font-weight:600;color:#fff;margin-bottom:8px;">${productName}</div>
                <div style="font-size:14px;color:#8e8e93;margin-bottom:16px;">Available at <strong style="color:#ebebf5;">${storeName}</strong></div>
                ${priceCardHtml}
              </div>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${productUrl}"
                       style="display:inline-block;background:#0071e3;color:#fff;font-size:16px;font-weight:600;
                              text-decoration:none;padding:14px 40px;border-radius:980px;letter-spacing:-0.2px;">
                      Shop Now${priceStr}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color:#636366;font-size:13px;margin:28px 0 0;text-align:center;">
                Act fast — limited stock items sell out quickly!
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#111;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center;">
              <p style="color:#48484a;font-size:12px;margin:0;">
                You received this because you're tracking this item on TrackIt.<br/>
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings"
                   style="color:#0071e3;text-decoration:none;">Manage notification preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  await transporter.sendMail({
    from: `"TrackIt Alerts" <${from}>`,
    to,
    subject,
    html,
  });
}
