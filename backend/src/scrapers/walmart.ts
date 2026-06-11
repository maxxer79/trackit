import { BaseScraper, StockResult } from './base';

export class WalmartScraper extends BaseScraper {
  constructor() {
    super('walmart');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      // storeProductId is the DB record id (cuid), NOT an item id — only
      // use it if it's actually numeric
      const itemId =
        (storeProductId && /^\d+$/.test(storeProductId) ? storeProductId : undefined) ||
        productUrl.match(/\/ip\/[^/]+\/(\d+)/)?.[1];

      if (itemId) {
        // Try Walmart API first
        const apiUrl = `https://www.walmart.com/ip/api/${itemId}`;
        try {
          const response = await this.client.get(apiUrl);
          const data = response.data;
          const available = data?.item?.availabilityStatus === 'IN_STOCK';
          const price = data?.item?.priceInfo?.currentPrice?.price;

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

      const html = await this.fetchPage(productUrl);

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
