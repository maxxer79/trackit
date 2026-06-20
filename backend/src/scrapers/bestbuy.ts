import { BaseScraper, StockResult } from './base';
import axios from 'axios';
import { fetchRenderedHtml, getSolverrSession, SolverrSession } from './browserFetch';

type Status = StockResult['status'];

/**
 * Best Buy scraper.
 *
 * Best Buy blocks plain server requests and loads the buy-button state via a
 * late XHR, so a rendered SSR snapshot usually has no stock signal. The reliable
 * source is the public priceBlocks availability API — we reach it past the bot
 * wall by replaying a FlareSolverr-validated session cookie, and CACHE that
 * session across all Best Buy products (bestbuy.com cookies are domain-wide), so
 * normally only one FlareSolverr solve covers the whole catalogue for ~30 min.
 */
export class BestBuyScraper extends BaseScraper {
  private session: SolverrSession | null = null;

  constructor() {
    super('bestbuy');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    let sku =
      (storeProductId && /^\d{7,8}$/.test(storeProductId) ? storeProductId : undefined) ||
      productUrl.match(/\/(\d{7,8})\.p/)?.[1] ||
      productUrl.match(/[?&]skuId=(\d+)/)?.[1] ||
      productUrl.match(/\/sku\/(\d{5,9})(?:[/?#]|$)/)?.[1];

    // 1. Authoritative priceBlocks API (plain → FlareSolverr-cookie replay).
    if (sku) {
      const api = await this.checkViaApi(sku, productUrl);
      if (api.status !== 'UNKNOWN') return api;
    }

    // 2. Newer /product/{name}/{code} URLs carry no numeric SKU. Render the page
    //    (gets past the bot wall), check for any embedded signal, and mine the
    //    SKU so we can hit the API with it.
    const html = await fetchRenderedHtml(productUrl);
    if (html && !this.isBotBlocked(html)) {
      if (!sku) sku = html.match(/"skuId"\s*:\s*"?(\d{6,8})"?/i)?.[1];

      const embedded = this.detectFromHtml(html);
      if (embedded !== 'UNKNOWN') {
        return { storeSlug: this.storeSlug, status: embedded, price: this.priceFromHtml(html), productUrl };
      }
      if (sku) {
        const api = await this.checkViaApi(sku, productUrl);
        if (api.status !== 'UNKNOWN') return api;
      }
    }

    return {
      storeSlug: this.storeSlug,
      status: 'UNKNOWN',
      productUrl,
      message: html ? 'Best Buy page had no recognizable stock signal' : 'Best Buy render failed/blocked',
    };
  }

  private async checkViaApi(sku: string, productUrl: string): Promise<StockResult> {
    const apiUrl = `https://www.bestbuy.com/api/3.0/priceBlocks?skus=${sku}`;

    // Try a plain request first (cheap, works when not actively blocked).
    let data = await this.fetchApi(apiUrl, null);
    if (!data) {
      // Reuse a cached FlareSolverr session across products; only solve again if
      // we don't have one or it stopped working.
      if (!this.session) this.session = await getSolverrSession(productUrl).catch(() => null);
      if (this.session) {
        data = await this.fetchApi(apiUrl, this.session);
        if (!data) this.session = null; // expired/invalid — re-solve next time
      }
    }
    if (!data) return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl };

    const availability = data.sku?.buttonState?.buttonState;
    const price = data.sku?.currentPrice?.currentPrice;

    if (!availability) return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl };

    let status: Status = 'OUT_OF_STOCK';
    if (availability === 'ADD_TO_CART' || availability === 'COMING_SOON_BUT_AVAILABLE') status = 'IN_STOCK';
    else if (availability === 'PRE_ORDER') status = 'PREORDER';

    return { storeSlug: this.storeSlug, status, price: price ? parseFloat(price) : undefined, productUrl };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async fetchApi(apiUrl: string, session: SolverrSession | null): Promise<any | null> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': session?.userAgent || this.userAgent,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (session) headers.Cookie = session.cookieHeader;
      const r = await axios.get(apiUrl, { headers, timeout: session ? 15000 : 10000, validateStatus: () => true });
      if (r.status === 200 && Array.isArray(r.data) && r.data[0]) return r.data[0];
    } catch {
      /* fall through to null */
    }
    return null;
  }

  // Best Buy SSR occasionally embeds availability in hydration JSON.
  private detectFromHtml(html: string): Status {
    if (
      /"buttonState"\s*:\s*"ADD_TO_CART"/i.test(html) ||
      /"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?InStock"/i.test(html)
    )
      return 'IN_STOCK';
    if (/"buttonState"\s*:\s*"PRE_ORDER"/i.test(html)) return 'PREORDER';
    if (
      /"buttonState"\s*:\s*"SOLD_OUT"/i.test(html) ||
      /"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?OutOfStock"/i.test(html)
    )
      return 'OUT_OF_STOCK';
    return 'UNKNOWN';
  }

  private priceFromHtml(html: string): number | undefined {
    const m = html.match(/"customerPrice"\s*:\s*([\d.]+)/i) || html.match(/"currentPrice"\s*:\s*([\d.]+)/i);
    return m ? parseFloat(m[1]) : undefined;
  }
}
