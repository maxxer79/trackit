/**
 * Hasbro Pulse scraper — uses the Salesforce Commerce Cloud (SFCC/Demandware)
 * OCAPI directly, because hasbropulse.com is a JS-rendered SPA that returns an
 * empty HTML shell on plain HTTP fetches.
 *
 * Product URL formats:
 *   https://www.hasbropulse.com/product/{name}/{SKU}   ← preferred, SKU extractable
 *   https://www.hasbropulse.com/products/{slug}        ← no SKU, falls back to HTML
 */
import axios from 'axios';
import { BaseScraper, StockResult } from './base';

const SFCC_SITE_ID = 'hasbropulse';
const SFCC_API_VERSION = 'v22_4';
// Hasbro Pulse allows unauthenticated OCAPI reads with this open client_id
const SFCC_CLIENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export class HasbroPulseScraper extends BaseScraper {
  constructor() {
    super('hasbropulse');
  }

  /**
   * Extracts the SFCC SKU/product-id from a Hasbro Pulse URL.
   * e.g. /product/marvel-legends-wolverine/F9018  →  "F9018"
   */
  private extractSku(url: string): string | null {
    const match = url.match(/\/product\/[^/?#]+\/([^/?#]+)/i);
    return match ? match[1] : null;
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    // storeProductId is the DB record id (cuid), NOT a Hasbro SKU — only
    // use it if it looks like one (e.g. "F9018", short letter+digits)
    const sku =
      (storeProductId && /^[A-Z]\d{3,5}[A-Z0-9]{0,3}$/i.test(storeProductId) ? storeProductId : undefined) ||
      this.extractSku(productUrl);

    if (sku) {
      return this.checkViaOcapi(sku, productUrl);
    }

    // No SKU in URL — fall back to best-effort HTML parse
    return this.checkViaHtml(productUrl);
  }

  // ─── SFCC OCAPI ────────────────────────────────────────────────────────────

  private async checkViaOcapi(sku: string, productUrl: string): Promise<StockResult> {
    try {
      const apiUrl =
        `https://www.hasbropulse.com/s/${SFCC_SITE_ID}/dw/shop/${SFCC_API_VERSION}` +
        `/products/${encodeURIComponent(sku)}?expand=availability,prices&client_id=${SFCC_CLIENT_ID}`;

      const response = await axios.get(apiUrl, {
        timeout: 12000,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
      });

      const data = response.data;
      if (!data) {
        return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl };
      }

      const inv = data.inventory;
      let status: StockResult['status'] = 'UNKNOWN';

      if (inv) {
        if (inv.preorderable === true) {
          status = 'PREORDER';
        } else if (inv.orderable === true) {
          status = 'IN_STOCK';
        } else if (inv.orderable === false) {
          status = 'OUT_OF_STOCK';
        }
      }

      // Price — SFCC returns price as a plain number
      const price: number | undefined =
        data.price ?? data.prices?.usd ?? undefined;

      return {
        storeSlug: this.storeSlug,
        status,
        price: typeof price === 'number' ? price : undefined,
        productUrl,
      };
    } catch (error: any) {
      // 401/403 means OCAPI access is locked down — fall back to HTML
      const httpStatus = error?.response?.status;
      if (httpStatus === 401 || httpStatus === 403) {
        return this.checkViaHtml(productUrl);
      }
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: `OCAPI error (${httpStatus ?? error.message})`,
      };
    }
  }

  // ─── HTML fallback ─────────────────────────────────────────────────────────

  private async checkViaHtml(productUrl: string): Promise<StockResult> {
    try {
      const html = await this.fetchPage(productUrl);
      const $ = this.loadHtml(html);
      const bodyText = $('body').text().toLowerCase();

      // SFCC pages often embed JSON-LD or window.__PRELOADED_STATE__ data
      let schemaStatus: StockResult['status'] | null = null;

      $('script[type="application/ld+json"]').each((_i, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}');
          const avail =
            json?.offers?.availability ||
            (Array.isArray(json?.offers) ? json.offers[0]?.availability : null);
          if (avail) {
            const a = avail.toLowerCase();
            if (a.includes('instock')) schemaStatus = 'IN_STOCK';
            else if (a.includes('outofstock')) schemaStatus = 'OUT_OF_STOCK';
            else if (a.includes('preorder')) schemaStatus = 'PREORDER';
          }
        } catch {}
      });

      if (schemaStatus) {
        return { storeSlug: this.storeSlug, status: schemaStatus, productUrl };
      }

      // Text-based signals
      if (
        bodyText.includes('add to cart') ||
        bodyText.includes('add to bag') ||
        bodyText.includes('buy now')
      ) {
        return { storeSlug: this.storeSlug, status: 'IN_STOCK', productUrl };
      }

      if (
        bodyText.includes('out of stock') ||
        bodyText.includes('sold out') ||
        bodyText.includes('notify me when available')
      ) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
      }

      if (bodyText.includes('pre-order') || bodyText.includes('preorder')) {
        return { storeSlug: this.storeSlug, status: 'PREORDER', productUrl };
      }

      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl };
    } catch (error: any) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: error.message,
      };
    }
  }
}
