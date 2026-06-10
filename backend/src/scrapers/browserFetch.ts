/**
 * Shared headless-browser fetch for scrapers.
 *
 * Used when a retailer blocks plain HTTP requests (403/429/503, Cloudflare,
 * PerimeterX, etc.) or serves a JS-only shell. Launches Chromium with the
 * stealth plugin so the request looks like a real customer's browser.
 *
 * All browser fetches are serialized through a single queue so concurrent
 * scrape jobs can't launch a pile of Chromium instances on the NAS.
 */
import logger from '../utils/logger';

let queue: Promise<unknown> = Promise.resolve();

export function fetchRenderedHtml(url: string, timeoutMs = 40000): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let browser: any;
    try {
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
          '--disable-gpu', '--window-size=1280,800',
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );

      logger.info(`[BrowserFetch] Rendering ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
      // Give client-side rendering a moment to settle
      await new Promise<void>((r) => setTimeout(r, 2500));

      // Cloudflare-style interstitials ("Just a moment...", "Checking your
      // browser") usually auto-solve with stealth in a few seconds — poll
      // until the title changes or we give up.
      const isInterstitial = (t: string) =>
        /just a moment|checking your browser|attention required|security check/i.test(t);
      for (let i = 0; i < 6; i++) {
        const title: string = await page.title().catch(() => '');
        if (!isInterstitial(title)) break;
        logger.info(`[BrowserFetch] Challenge interstitial detected ("${title}") — waiting (${i + 1}/6)`);
        await new Promise<void>((r) => setTimeout(r, 3000));
      }

      const html: string = await page.content();
      const finalTitle: string = await page.title().catch(() => '');
      logger.info(`[BrowserFetch] Got ${html.length} bytes from ${url} (title: "${finalTitle}")`);
      return html;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[BrowserFetch] Failed for ${url}: ${msg}`);
      return null;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  };

  // Serialize: each fetch waits for the previous one to finish
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result as Promise<string | null>;
}
