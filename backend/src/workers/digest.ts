/**
 * Daily/weekly digest email worker.
 *
 * Runs once a day (08:00 server time). For each user who opted in
 * (digestFrequency = 'daily' | 'weekly'), and on a day that cadence is due
 * (weekly = Mondays), it summarizes the alerts that fired for them in the window
 * (last 1 or 7 days) into a single grouped email. Empty digests are skipped so
 * nobody gets a "nothing happened" email.
 */
import cron from 'node-cron';
import { prisma } from '../config/database';
import { sendRawEmail } from '../services/email';
import {
  normalizeFrequency,
  windowDays,
  shouldRunForFrequency,
  groupDigestAlerts,
  DigestAlert,
  DigestSection,
} from '../services/digest';
import logger from '../utils/logger';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER || process.env.SENDGRID_API_KEY);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function sectionHtml(s: DigestSection): string {
  const rows = s.items
    .map((it) => {
      const price = it.price != null ? ` — $${it.price.toFixed(2)}` : '';
      const store = it.storeName ? ` <span style="color:#8e8e93;">at ${esc(it.storeName)}</span>` : '';
      const name = it.productUrl
        ? `<a href="${esc(it.productUrl)}" style="color:#0071e3;text-decoration:none;">${esc(it.productName)}</a>`
        : esc(it.productName);
      return `<li style="margin:0 0 6px;color:#ebebf5;font-size:14px;">${name}${store}${esc(price)}</li>`;
    })
    .join('');
  return `
    <div style="margin:0 0 22px;">
      <div style="font-size:15px;font-weight:700;color:#fff;margin:0 0 10px;">${s.emoji} ${esc(s.label)} <span style="color:#8e8e93;font-weight:500;">(${s.items.length})</span></div>
      <ul style="margin:0;padding:0 0 0 18px;">${rows}</ul>
    </div>`;
}

export function buildDigestHtml(name: string, periodLabel: string, sections: DigestSection[], total: number): string {
  return `
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#0071e3,#00c6ff);border-radius:16px 16px 0 0;padding:28px 40px;text-align:center;">
        <div style="font-size:26px;font-weight:700;color:#fff;letter-spacing:-0.5px;">TrackIt</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px;">${esc(periodLabel)} digest</div>
      </td></tr>
      <tr><td style="background:#1c1c1e;padding:32px 40px;">
        <p style="color:#ebebf5;font-size:16px;margin:0 0 6px;">Hi ${esc(name || 'there')},</p>
        <p style="color:#8e8e93;font-size:14px;margin:0 0 26px;">${total} update${total === 1 ? '' : 's'} on the items you're tracking ${esc(periodLabel.toLowerCase())}.</p>
        ${sections.map(sectionHtml).join('')}
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td align="center">
          <a href="${esc(FRONTEND_URL)}/dashboard" style="display:inline-block;background:#0071e3;color:#fff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 34px;border-radius:980px;">Open your dashboard</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="background:#111;border-radius:0 0 16px 16px;padding:18px 40px;text-align:center;">
        <p style="color:#48484a;font-size:12px;margin:0;">You're getting this because you turned on digest emails.<br/>
        <a href="${esc(FRONTEND_URL)}/settings" style="color:#0071e3;text-decoration:none;">Change frequency or turn off</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`.trim();
}

/** Build + send one user's digest. Returns true if an email was sent. */
async function sendUserDigest(
  user: { id: string; email: string | null; name: string | null; digestFrequency: string },
  now: Date
): Promise<boolean> {
  const freq = normalizeFrequency(user.digestFrequency);
  if (!user.email || !shouldRunForFrequency(freq, now)) return false;

  const since = new Date(now.getTime() - windowDays(freq) * 86_400_000);
  const alerts = await prisma.alert.findMany({
    where: { userId: user.id, sentAt: { gte: since } },
    orderBy: { sentAt: 'desc' },
    take: 200,
  });
  if (alerts.length === 0) return false; // skip empty digests

  // Resolve product names/slugs in one batch.
  const productIds = [...new Set(alerts.map((a) => a.productId).filter(Boolean) as string[])];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, slug: true } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const digestAlerts: DigestAlert[] = alerts.map((a) => {
    const p = a.productId ? productById.get(a.productId) : undefined;
    return {
      type: a.type,
      productName: p?.name ?? a.storeName ?? 'A tracked item',
      productSlug: p?.slug ?? null,
      storeName: a.storeName,
      price: a.price,
      productUrl: a.productUrl ?? (p?.slug ? `${FRONTEND_URL}/product/${p.slug}` : null),
      sentAt: a.sentAt,
    };
  });

  const { sections, total } = groupDigestAlerts(digestAlerts);
  const periodLabel = freq === 'weekly' ? 'Weekly' : 'Daily';
  const subject = `🔔 Your ${periodLabel.toLowerCase()} TrackIt digest — ${total} update${total === 1 ? '' : 's'}`;
  await sendRawEmail({ to: user.email, subject, html: buildDigestHtml(user.name ?? 'there', periodLabel, sections, total) });
  return true;
}

export async function runDigest(now: Date = new Date()): Promise<void> {
  if (!smtpConfigured()) {
    logger.info('digest skipped — SMTP not configured');
    return;
  }
  const users = await prisma.user.findMany({
    where: { isActive: true, digestFrequency: { in: ['daily', 'weekly'] } },
    select: { id: true, email: true, name: true, digestFrequency: true },
  });
  if (users.length === 0) return;

  let sent = 0;
  for (const user of users) {
    try {
      if (await sendUserDigest(user, now)) sent++;
    } catch (err: any) {
      logger.warn('digest send failed for user', { userId: user.id, error: err?.message });
    }
  }
  logger.info('digest run complete', { candidates: users.length, sent });
}

export function startDigest(): void {
  // Daily at 08:00 server time. 'daily' users send every run; 'weekly' users
  // send only on Mondays (decided per-user in shouldRunForFrequency).
  cron.schedule('0 8 * * *', () => {
    runDigest().catch((err) => logger.error('digest worker failed', { error: err?.message }));
  });
  logger.info('digest worker scheduled (daily 08:00; weekly users on Mondays)');
}
