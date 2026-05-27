import nodemailer from 'nodemailer';
import logger from '../utils/logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface EmailPayload {
  to: string;
  name: string;
  title: string;
  body: string;
  url?: string;
  imageUrl?: string;
}

export const sendStockAlertEmail = async (payload: EmailPayload): Promise<void> => {
  if (!process.env.SMTP_USER) { logger.warn('SMTP not configured, skipping email'); return; }
  try {
    await transporter.sendMail({
      from: `"TrackIt Alerts" <${process.env.SMTP_USER}>`,
      to: payload.to,
      subject: payload.title,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.1)">
        <tr><td style="background:linear-gradient(135deg,#0071e3,#42a5f5);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700">TrackIt</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px">Stock Alert</p>
        </td></tr>
        <tr><td style="padding:40px">
          <h2 style="color:#1d1d1f;font-size:22px;margin:0 0 16px">${payload.title}</h2>
          <p style="color:#6e6e73;font-size:16px;line-height:1.6;margin:0 0 24px">Hi ${payload.name},</p>
          <p style="color:#1d1d1f;font-size:16px;line-height:1.6;margin:0 0 32px">${payload.body}</p>
          ${payload.url ? `<a href="${payload.url}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:14px 32px;border-radius:980px;font-size:15px;font-weight:600">Buy Now →</a>` : ''}
        </td></tr>
        <tr><td style="background:#f5f5f7;padding:24px 40px;text-align:center">
          <p style="color:#86868b;font-size:12px;margin:0">You're receiving this because you set up a TrackIt alert.</p>
          <p style="color:#86868b;font-size:12px;margin:8px 0 0">© ${new Date().getFullYear()} TrackIt. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });
  } catch (error) {
    logger.error('Email send error', error);
  }
};
