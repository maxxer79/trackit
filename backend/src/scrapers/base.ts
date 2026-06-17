import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import type { StockResult, StockStatus } from '@shared';
import { withRetry } from './retry';
import { scraperRateLimiter } from './rateLimiter';
import logger from '../utils/logger';

// Re-export the shared scraper contract so existing `import { StockResult }
// from './base'` sites across the scrapers keep working unchanged.
export type { StockResult, StockStatus };

export abstract class BaseScraper {
  protected storeSlug: string;
  protected client: AxiosInstance;
  protected userAgent: string;

  constructor(storeSlug: string) {
    this.storeSlug = storeSlug;
    this.userAgent =
      process.env.SCRAPER_USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    this.client = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        // Full modern-Chrome client-hint headers — Akamai/PerimeterX
        // (GameStop, Dell) reject requests missing these
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Per-retailer pacing: every request through this client waits for its
    // store's rate-limit slot, so concurrent worker jobs hitting the same
    // retailer are spaced out (shared singleton keyed by storeSlug).
    this.client.interceptors.request.use(async (config) => {
      await scraperRateLimiter.acquire(this.storeSlug);
      return config;
    });
  }

  abstract checkStock(productUrl: string, storeProductId?: string): Promise<StockResult>;

  protected async fetchPage(url: string): Promise<string> {
    // Retry transient failures (network resets, timeouts, 5xx) with jittered
    // backoff before letting the scraper fall through to its browser fallback.
    // Bot-blocks (403) and 429 are NOT retried — see retry.ts.
    const response = await withRetry(() => this.client.get(url), {
      onRetry: ({ attempt, delayMs, error }) =>
        logger.debug('scraper fetch retry', {
          storeSlug: this.storeSlug,
          url,
          attempt,
          delayMs,
          error: (error as { message?: string })?.message,
        }),
    });
    return response.data;
  }

  protected loadHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  protected parsePrice(priceStr: string): number | undefined {
    const match = priceStr.replace(/[^0-9.]/g, '');
    const price = parseFloat(match);
    return isNaN(price) ? undefined : price;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Detect bot-block / challenge / JS-shell pages. When this returns true,
   * the scraper MUST return UNKNOWN — never OUT_OF_STOCK — because we
   * learned nothing about real availability.
   */
  protected isBotBlocked(html: string): boolean {
    if (!html || html.length < 1500) return true; // tiny shell or empty body

    // IMPORTANT: only inspect VISIBLE text and the <title>. Legit pages
    // served through Cloudflare/PerimeterX contain challenge-script
    // fragments (cf-chl-, px-captcha, etc.) in their hidden JS even when
    // the page is a perfectly normal product page — scanning raw HTML
    // caused false "bot-blocked" results on real pages.
    let visible: string;
    let title: string;
    try {
      const $ = this.loadHtml(html);
      $('script, style, noscript, link, meta').remove();
      title = ($('title').text() || '').toLowerCase();
      visible = ($('body').text() || '').toLowerCase().replace(/\s+/g, ' ').trim();
    } catch {
      return false; // can't parse — let detection logic decide
    }

    // Challenge pages have almost no visible content
    const tinyPage = visible.length < 400;

    const titleMarkers = [
      'just a moment',
      'access denied',
      'attention required',
      'security check',
      'are you a robot',
      'robot or human',
      'pardon our interruption',
    ];
    if (titleMarkers.some((m) => title.includes(m))) return true;

    const textMarkers = [
      'pardon our interruption',
      'are you a human',
      'robot or human',
      'verify you are a human',
      'verify yourself to continue',
      'request blocked',
      'enable javascript and cookies to continue',
      'discuss automated access',
      'type the characters you see',
      'unusual traffic from your',
      'checking your browser',
      'needs to review the security of your connection',
    ];
    const hasTextMarker = textMarkers.some((m) => visible.includes(m));

    // A real challenge page is small AND carries a marker; a big product
    // page that merely mentions one of these phrases somewhere is fine.
    if (hasTextMarker && tinyPage) return true;
    if (hasTextMarker && visible.length < 2000) return true;

    return false;
  }
}
