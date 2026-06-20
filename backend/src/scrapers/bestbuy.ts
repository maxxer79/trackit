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
  // url → numeric SKU, so we only render-and-mine a no-SKU URL once.
  private skuCache = new Map<string, string>();

  constructor() {
    super('bestbuy');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    let sku =
      (storeProductId && /^\d{7,8}$/.test(storeProductId) ? storeProductId : undefined) ||
      productUrl.match(/\/(\d{7,8})\.p/)?.[1] ||
      productUrl.match(/[?&]skuId=(\d+)/)?.[1] ||
      productUrl.match(/\/sku\/(\d{5,9})(?:[/?#]|$)/)?.[1] ||
      this.skuCache.get(productUrl);

    // Fast-fail non-product URLs (homepage / search) — rendering bestbuy.com
    // just hangs and never yields a product signal.
    if (!sku && !/\/(product|site)\//i.test(productUrl)) {
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'Not a Best Buy product URL (homepage or search page?)' };
    }

    // 1. Authoritative priceBlocks API. If we already know the SKU (from the URL
    //    or the cache), this needs NO page render at all.
    if (sku) {
      const api = await this.checkViaApi(sku, productUrl);
      if (api.status !== 'UNKNOWN') return api;
    }

    // 2. Newer /product/{name}/{code} URLs carry no numeric SKU. Render the page
    //    ONCE to mine + cache the SKU, then hit the API with it.
    const html = await fetchRenderedHtml(productUrl);
    if (html && !this.isBotBlocked(html)) {
      if (!sku) {
        sku = this.mineSku(html);
        if (sku) this.skuCache.set(productUrl, sku);
      }

      // API is authoritative — try it BEFORE reading the page. Best Buy product
      // pages embed many OTHER products (related items, open-box), so a
      // whole-page scan can pick up a related item's "SOLD_OUT" and wrongly
      // mark the main item out of stock.
      if (sku) {
        const api = await this.checkViaApi(sku, productUrl);
        if (api.status !== 'UNKNOWN') return api;
      }

      // Last resort: only a POSITIVE signal from the HTML is trustworthy here.
      const embedded = this.detectFromHtml(html);
      if (embedded !== 'UNKNOWN') {
        return { storeSlug: this.storeSlug, status: embedded, price: this.priceFromHtml(html), productUrl };
      }
    }

    return {
      storeSlug: this.storeSlug,
      status: 'UNKNOWN',
      productUrl,
      message: html ? 'Best Buy page had no recognizable stock signal' : 'Best Buy render failed/blocked',
    };
  }

  // Mine the numeric SKU from the rendered page. Best Buy HTML-encodes the JSON
  // in <meta> (e.g. &quot;skuId&quot;:&quot;6618904&quot;), so match both encoded
  // and raw forms, plus the visible "SKU: 6618904".
  private mineSku(html: string): string | undefined {
    // Decode the common entities first so encoded JSON in <meta>/attributes
    // (&quot;skuId&quot;:&quot;6618904&quot;, &#x22;, etc.) matches the same as raw.
    const decoded = html
      .replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&#x2f;|&#47;/gi, '/')
      .replace(/&amp;/gi, '&');
    const m =
      decoded.match(/"skuId"\s*:\s*"?(\d{6,8})/i) || // analytics meta / hydration JSON
      decoded.match(/"sku"\s*:\s*"?(\d{6,8})/i) || // JSON-LD Product.sku
      decoded.match(/\bskuId["'=:\s]+(\d{6,8})/i) || // looser skuId=… / skuId:…
      decoded.match(/\bSKU:?\s*(?:<[^>]*>\s*)?(\d{6,8})\b/i); // visible "SKU: 6618904"
    return m?.[1];
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
    // Real path is sku.price.currentPrice; fall back to the priceDomain's
    // customer price.
    const rawPrice = data.sku?.price?.currentPrice ?? data.sku?.price?.priceDomain?.customerPrice;
    const price = rawPrice != null ? Number(rawPrice) : undefined;

    if (!availability) return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl };

    let status: Status = 'OUT_OF_STOCK';
    if (availability === 'ADD_TO_CART' || availability === 'COMING_SOON_BUT_AVAILABLE') status = 'IN_STOCK';
    else if (availability === 'PRE_ORDER') status = 'PREORDER';

    return { storeSlug: this.storeSlug, status, price: Number.isNaN(price as number) ? undefined : price, productUrl };
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

  // Best Buy product pages embed many products' states, so only a POSITIVE
  // signal is trustworthy from a whole-page scan — never infer OUT_OF_STOCK here
  // (a related/open-box item's SOLD_OUT would poison the main item). When the
  // API can't be reached and the page shows no positive signal, return UNKNOWN
  // (which safely keeps the previous value) rather than guessing out-of-stock.
  private detectFromHtml(html: string): Status {
    if (/"buttonState"\s*:\s*"ADD_TO_CART"/i.test(html)) return 'IN_STOCK';
    if (/"buttonState"\s*:\s*"PRE_ORDER"/i.test(html)) return 'PREORDER';
    return 'UNKNOWN';
  }

  private priceFromHtml(html: string): number | undefined {
    const m = html.match(/"customerPrice"\s*:\s*([\d.]+)/i) || html.match(/"currentPrice"\s*:\s*([\d.]+)/i);
    return m ? parseFloat(m[1]) : undefined;
  }
}
