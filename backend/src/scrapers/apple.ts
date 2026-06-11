/**
 * Apple Store scraper.
 *
 * Apple's buy pages (apple.com/shop/buy-mac/...) are configurators showing
 * MANY products — there is no single stock status to read from them. Real
 * availability lives in Apple's fulfillment API, keyed by PART NUMBER
 * (e.g. MX2E3LL/A). Track Apple products using their direct product URLs:
 *   https://www.apple.com/shop/product/{PARTNUMBER}
 * (Open the product page on apple.com after picking a configuration — the
 * part-number URL is what the "Add to Bag" flow uses.)
 */
import axios from 'axios';
import { BaseScraper, StockResult } from './base';
import { fetchRenderedHtml } from './browserFetch';
import logger from '../utils/logger';

export class AppleScraper extends BaseScraper {
  constructor() {
    super('apple');
  }

  async checkStock(productUrl: string): Promise<StockResult> {
    // Part numbers look like MX2E3LL/A — in URLs as /shop/product/MX2E3LL/A
    const m = productUrl.match(/\/shop\/product\/([A-Z0-9]{4,12})(?:\/([A-Z]))?(?:[/?#]|$)/i);
    const part = m ? (m[2] ? `${m[1].toUpperCase()}/${m[2].toUpperCase()}` : m[1].toUpperCase()) : undefined;

    if (!part) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message:
          'Apple configurator pages show many products — track a specific one using an apple.com/shop/product/{PARTNUMBER} URL',
      };
    }

    const apiUrl =
      `https://www.apple.com/shop/fulfillment-messages` +
      `?pl=true&mts.0=regular&parts.0=${encodeURIComponent(part)}`;

    // Attempt 1: direct API call
    try {
      const { data } = await axios.get(apiUrl, {
        timeout: 12000,
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      });
      const result = this.mapFulfillment(part, data, productUrl);
      if (result) return result;
    } catch (err: any) {
      logger.warn(`[Apple] fulfillment API failed for ${part}: ${err.message}`);
    }

    // Attempt 2: API through FlareSolverr / Chromium
    const body = await fetchRenderedHtml(apiUrl);
    if (body) {
      const start = body.indexOf('{');
      const end = body.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const data = JSON.parse(
            body.slice(start, end + 1).replace(/&quot;/g, '"').replace(/&amp;/g, '&')
          );
          const result = this.mapFulfillment(part, data, productUrl);
          if (result) return result;
        } catch {}
      }
      // Raw regex backstop
      if (/"isBuyable"\s*:\s*true/i.test(body)) {
        return { storeSlug: this.storeSlug, status: 'IN_STOCK', productUrl };
      }
      if (/"isBuyable"\s*:\s*false/i.test(body)) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
      }
    }

    return {
      storeSlug: this.storeSlug,
      status: 'UNKNOWN',
      productUrl,
      message: `Apple fulfillment data unavailable for part ${part}`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapFulfillment(part: string, data: any, productUrl: string): StockResult | null {
    const dm = data?.body?.content?.deliveryMessage?.[part];
    const buyable = dm?.regular?.isBuyable ?? dm?.isBuyable;
    logger.info(`[Apple ${part}] isBuyable=${buyable}`);
    if (buyable === true) {
      return { storeSlug: this.storeSlug, status: 'IN_STOCK', productUrl };
    }
    if (buyable === false) {
      return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
    }
    return null;
  }
}
