import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

/**
 * Restock "proof" screenshots. On a restock we capture the product page with the
 * existing Puppeteer/Chromium setup and save a PNG to SCREENSHOT_DIR, which the
 * operator mounts to a persistent volume. Served read-only at /api/screenshots.
 * The whole feature is gated behind SCREENSHOT_ENABLED=true so deployments
 * without a writable volume (or that don't want it) are unaffected.
 */

const DIR = process.env.SCREENSHOT_DIR || '/app/screenshots';

export function screenshotEnabled(): boolean {
  return process.env.SCREENSHOT_ENABLED === 'true';
}
export function screenshotDir(): string {
  return DIR;
}
export function ensureScreenshotDir(): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch (err: any) {
    logger.warn('could not create screenshot dir', { dir: DIR, error: err?.message });
  }
}

// Capture the product page; returns the stored filename (not full path) or null.
// Never throws — a failed screenshot must not block a restock notification.
export async function captureScreenshot(url: string): Promise<string | null> {
  if (!screenshotEnabled() || !url) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  try {
    ensureScreenshotDir();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteerExtra = require('puppeteer-extra');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());

    browser = await puppeteerExtra.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
        '--disable-gpu', '--window-size=1280,900',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Let above-the-fold content paint (price/stock badges, images).
    await new Promise<void>((r) => setTimeout(r, 2500));

    const filename = `restock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    await page.screenshot({ path: path.join(DIR, filename), type: 'png' });
    logger.info('restock screenshot captured', { url, filename });
    return filename;
  } catch (err: any) {
    logger.warn('screenshot capture failed', { url, error: err?.message });
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Delete screenshots older than maxAgeDays. Best-effort; swallows errors.
export function pruneOldScreenshots(maxAgeDays = 60): void {
  try {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    for (const f of fs.readdirSync(DIR)) {
      const fp = path.join(DIR, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* dir may not exist yet — fine */
  }
}
