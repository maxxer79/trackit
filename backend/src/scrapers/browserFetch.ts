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
import axios from 'axios';
import logger from '../utils/logger';

let queue: Promise<unknown> = Promise.resolve();

/**
 * FlareSolverr (https://github.com/FlareSolverr/FlareSolverr) is a
 * self-hosted Cloudflare challenge solver. If FLARESOLVERR_URL is set
 * (e.g. http://flaresolverr:8191), use it first — it gets past Cloudflare
 * protection that defeats plain stealth Chromium (e.g. BigBadToyStore).
 */
async function fetchViaFlareSolverr(url: string, timeoutMs: number): Promise<string | null> {
  const base = process.env.FLARESOLVERR_URL;
  if (!base) return null;
  try {
    logger.info(`[FlareSolverr] Solving ${url}`);
    const resp = await axios.post(
      `${base.replace(/\/$/, '')}/v1`,
      { cmd: 'request.get', url, maxTimeout: timeoutMs },
      { timeout: timeoutMs + 15000, headers: { 'Content-Type': 'application/json' } }
    );
    const solution = resp.data?.solution;
    if (resp.data?.status === 'ok' && solution?.response) {
      const html: string = solution.response;
      // Some sites (Newegg) serve a non-Cloudflare block page that
      // FlareSolverr can't solve — don't return it as if it were real
      // content; fall through so local stealth Chromium gets a shot.
      // IMPORTANT: only small pages can be block pages. Large pages are
      // real content — their JS bundles legitimately contain phrases like
      // "access denied", which caused false rejections of good pages.
      const t = html.slice(0, 5000).toLowerCase() + html.slice(-2000).toLowerCase();
      const looksBlocked =
        html.length < 3000 ||
        (html.length < 80000 &&
          (t.includes('are you a human') ||
           t.includes('robot or human') ||
           t.includes('verify you are a human') ||
           t.includes('access denied') ||
           t.includes('request blocked')));
      if (looksBlocked) {
        logger.warn(`[FlareSolverr] Response for ${url} looks like a block page (${html.length} bytes) — trying local browser`);
        return null;
      }
      logger.info(`[FlareSolverr] Got ${html.length} bytes (HTTP ${solution.status}) for ${url}`);
      return html;
    }
    logger.warn(`[FlareSolverr] No solution for ${url}: ${resp.data?.message ?? 'unknown'}`);
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[FlareSolverr] Failed for ${url}: ${msg}`);
    return null;
  }
}

export interface RenderOptions {
  /** CSS selector to wait for after page load (local Chromium only) */
  waitSelector?: string;
  /** Skip FlareSolverr and go straight to local Chromium */
  skipFlareSolverr?: boolean;
}

/**
 * Extract JSON from a browser-rendered API response. Chrome wraps JSON in
 * its viewer markup (<pre> plus large viewer DOM via FlareSolverr) — naive
 * first-{-to-last-} slicing grabs viewer markup instead of the payload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractJsonFromRendered(body: string): any | null {
  const decode = (s: string) =>
    s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");

  // 1. Chrome JSON viewer: payload lives inside a <pre> element
  const preMatches = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/gi) ?? [];
  for (const pre of preMatches) {
    const inner = decode(pre.replace(/^<pre[^>]*>/i, '').replace(/<\/pre>$/i, '').trim());
    const s = inner.indexOf('{');
    const e = inner.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(inner.slice(s, e + 1));
      } catch {}
    }
  }

  // 2. Raw JSON body (no HTML wrapper)
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  // 3. Last resort: brace slice over the decoded body
  const decoded = decode(body);
  const s = decoded.indexOf('{');
  const e = decoded.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(decoded.slice(s, e + 1));
    } catch {}
  }
  return null;
}

/**
 * Strip ad-tracking params (utm_*, gclid, …) before fetching. Long
 * Google-Ads URLs are a bot-detection red flag (GameStop's Cloudflare
 * started hard-blocking them) and bust per-URL caches.
 */
function cleanTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    const junk = [...u.searchParams.keys()].filter((k) =>
      /^(utm_|gad_|itm_)/i.test(k) ||
      /^(gclid|gclsrc|gbraid|wbraid|cmpid|camptype|fbclid|msclkid)$/i.test(k)
    );
    junk.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Fetch a JSON API URL through a real Chromium navigation and return the
 * RAW response body — NOT the rendered page. Chrome's JSON viewer
 * virtualizes large documents (Target's 249KB fulfillment response), so the
 * rendered HTML is incomplete; the navigation response object gives us the
 * untouched bytes. Serialized through the same queue as fetchRenderedHtml.
 */
export function fetchRawJson(rawUrl: string, timeoutMs = 40000): Promise<any | null> {
  const url = cleanTrackingParams(rawUrl);
  const run = async (): Promise<any | null> => {
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
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({ Accept: 'application/json, text/plain, */*' });

      logger.info(`[BrowserFetch] Raw JSON fetch ${url}`);
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      if (!resp) {
        logger.warn(`[BrowserFetch] Raw JSON fetch got no response for ${url}`);
        return null;
      }
      const status = resp.status();
      const text: string = await resp.text();
      logger.info(`[BrowserFetch] Raw JSON HTTP ${status}, ${text.length} bytes for ${url}`);
      // Strip a Chrome JSON-viewer wrapper if the response came pre-rendered
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return JSON.parse(trimmed);
        } catch (e: any) {
          logger.warn(`[BrowserFetch] Raw JSON parse failed: ${e.message}`);
          return null;
        }
      }
      // Sometimes the body is HTML-wrapped even here — reuse the extractor
      return extractJsonFromRendered(text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[BrowserFetch] Raw JSON fetch failed for ${url}: ${msg}`);
      return null;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

export function fetchRenderedHtml(rawUrl: string, timeoutMs = 40000, opts: RenderOptions = {}): Promise<string | null> {
  const url = cleanTrackingParams(rawUrl);
  const run = async (): Promise<string | null> => {
    // Strategy 1: FlareSolverr (if configured) — best against Cloudflare
    if (!opts.skipFlareSolverr) {
      const solved = await fetchViaFlareSolverr(url, timeoutMs);
      if (solved) return solved;
    }

    // Strategy 2: local stealth Chromium
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

      logger.info(`[BrowserFetch] Rendering ${url}${opts.waitSelector ? ` (waiting for ${opts.waitSelector})` : ''}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
      // Give client-side rendering a moment to settle
      await new Promise<void>((r) => setTimeout(r, 2500));

      // Optionally wait for a specific element (e.g. Target's buy button,
      // which renders via late XHR after the initial page snapshot)
      if (opts.waitSelector) {
        await page.waitForSelector(opts.waitSelector, { timeout: 15000 }).catch(() => {
          logger.info(`[BrowserFetch] waitSelector "${opts.waitSelector}" never appeared`);
        });
      }

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
