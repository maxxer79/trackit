import { BaseScraper, StockResult, LocationContext } from './base';
import logger from '../utils/logger';

export class WalmartScraper extends BaseScraper {
  constructor() {
    super('walmart');
  }

  /**
   * Walmart keys the assortment (price AND availability) off a store the site
   * remembers in cookies rather than a URL param. These are the cookie names
   * Walmart's own web client sets.
   *
   * UNVERIFIED against a live session — unlike the Home Depot GraphQL and
   * Lowe's wpd shapes, this was not captured from a real browser. Until it is,
   * `verifyStoreEcho` below logs what Walmart actually echoed back so the first
   * real run reveals the truth, and zipCheck reports the row as unresolved
   * rather than presenting a possibly-national price as a per-ZIP one.
   */
  private locationCookies(location: LocationContext): string {
    return [
      `assortmentStoreId=${location.storeId}`,
      `locGuestData={"postalCode":"${location.zip}","storeIntent":"PICKUP","assortmentStoreId":"${location.storeId}"}`,
      `locDataV3={"assortment":{"stores":[{"id":"${location.storeId}"}]},"postalCode":"${location.zip}"}`,
    ].join('; ');
  }

  /**
   * Did Walmart honour the store we asked for? Returns the store id it actually
   * priced against when it can be found in the payload, else null.
   */
  private storeEcho(payload: string): string | null {
    const m =
      payload.match(/"assortmentStoreId"\s*:\s*"?(\d+)"?/i) ??
      payload.match(/"storeId"\s*:\s*"?(\d+)"?/i) ??
      payload.match(/"fulfillmentStoreId"\s*:\s*"?(\d+)"?/i);
    return m?.[1] ?? null;
  }

  async checkStock(
    productUrl: string,
    storeProductId?: string,
    location?: LocationContext
  ): Promise<StockResult> {
    try {
      // storeProductId is the DB record id (cuid), NOT an item id — only
      // use it if it's actually numeric
      const itemId =
        (storeProductId && /^\d+$/.test(storeProductId) ? storeProductId : undefined) ||
        productUrl.match(/\/ip\/[^/]+\/(\d+)/)?.[1];

      // Location, when supplied, rides along on every request below.
      const locHeaders: Record<string, string> = location
        ? { Cookie: this.locationCookies(location) }
        : {};

      if (itemId) {
        // Try Walmart API first
        const apiUrl = `https://www.walmart.com/ip/api/${itemId}`;
        try {
          const response = await this.client.get(apiUrl, { headers: locHeaders });
          const data = response.data;
          const available = data?.item?.availabilityStatus === 'IN_STOCK';
          const price = data?.item?.priceInfo?.currentPrice?.price;

          if (location) {
            const echo = this.storeEcho(JSON.stringify(data ?? null));
            logger.info(
              `[Walmart ${itemId}] requested store=${location.storeId} zip=${location.zip} → echoed store=${echo ?? 'NONE'}`
            );
          }

          return {
            storeSlug: this.storeSlug,
            status: available ? 'IN_STOCK' : 'OUT_OF_STOCK',
            price: price ? parseFloat(price) : undefined,
            productUrl,
          };
        } catch {
          // Fall through to HTML
        }
      }

      const html = await this.fetchPage(productUrl, locHeaders);

      if (location) {
        logger.info(
          `[Walmart] HTML path requested store=${location.storeId} zip=${location.zip} → echoed store=${this.storeEcho(html) ?? 'NONE'}`
        );
      }

      // Walmart "Robot or human?" challenge → UNKNOWN
      if (this.isBotBlocked(html)) {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: 'Walmart served a bot-challenge page',
        };
      }

      // Walmart embeds availability in __NEXT_DATA__ hydration JSON — most
      // reliable signal in the SSR output
      if (/"availabilityStatus"\s*:\s*"IN_STOCK"/i.test(html)) {
        const priceMatch = html.match(/"currentPrice"\s*:\s*\{\s*"price"\s*:\s*([\d.]+)/i);
        return {
          storeSlug: this.storeSlug,
          status: 'IN_STOCK',
          price: priceMatch ? parseFloat(priceMatch[1]) : undefined,
          productUrl,
        };
      }
      if (/"availabilityStatus"\s*:\s*"OUT_OF_STOCK"/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
      }

      const $ = this.loadHtml(html);

      const addToCart = $('button[data-automation-id="add-to-cart-btn"]').length > 0;
      const outOfStock = $('[data-automation-id="fulfillment-summary"]').text().includes('Out of stock');
      const priceText = $('[itemprop="price"]').attr('content') ||
                        $('[data-automation-id="product-price"]').text();

      return {
        storeSlug: this.storeSlug,
        status: addToCart ? 'IN_STOCK' : outOfStock ? 'OUT_OF_STOCK' : 'UNKNOWN',
        price: priceText ? this.parsePrice(priceText) : undefined,
        productUrl,
      };
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
