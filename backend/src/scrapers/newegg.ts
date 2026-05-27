import { BaseScraper, StockResult } from './base';

export class NeweggScraper extends BaseScraper {
  constructor() {
    super('newegg');
  }

  async checkStock(productUrl: string): Promise<StockResult> {
    try {
      const html = await this.fetchPage(productUrl);
      const $ = this.loadHtml(html);

      const addToCart = $('#btn-atc').length > 0 || $('.btn-primary.btn-wide').text().includes('Add to Cart');
      const soldOut = $('.product-flag.sold-out').length > 0 || $('button:contains("Auto Notify")').length > 0;
      const priceText = $('.price-current').first().text();

      let status: StockResult['status'] = 'UNKNOWN';
      if (addToCart) status = 'IN_STOCK';
      else if (soldOut) status = 'OUT_OF_STOCK';

      return {
        storeSlug: this.storeSlug,
        status,
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
