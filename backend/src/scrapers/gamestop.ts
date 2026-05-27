import { BaseScraper, StockResult } from './base';

export class GameStopScraper extends BaseScraper {
  constructor() {
    super('gamestop');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      const html = await this.fetchPage(productUrl);
      const $ = this.loadHtml(html);

      const addToCart = $('button[data-testid="addToCartButton"]').length > 0 ||
                        $('button:contains("Add to Cart")').length > 0;
      const notAvailable = $('button:contains("Notify Me")').length > 0 ||
                           $('.not-available').length > 0;
      const priceText = $('[data-testid="price"]').text() || $('[class*="ProductPrice"]').text();

      return {
        storeSlug: this.storeSlug,
        status: addToCart ? 'IN_STOCK' : notAvailable ? 'OUT_OF_STOCK' : 'UNKNOWN',
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
