import { BaseScraper, StockResult } from './base';

export class WalmartScraper extends BaseScraper {
  constructor() {
    super('walmart');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      const itemId = storeProductId || productUrl.match(/\/ip\/[^/]+\/(\d+)/)?.[1];

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
