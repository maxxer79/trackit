import { BaseScraper, StockResult } from './base';

export class AmazonScraper extends BaseScraper {
  constructor() {
    super('amazon');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      const asin = storeProductId || productUrl.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
      if (!asin) {
        return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl };
      }

      const cleanUrl = `https://www.amazon.com/dp/${asin}`;
      const html = await this.fetchPage(cleanUrl);

      // Amazon captcha/robot page → UNKNOWN, never a stock verdict
      if (this.isBotBlocked(html)) {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl: cleanUrl,
          message: 'Amazon served a captcha/robot-check page',
        };
      }

      const $ = this.loadHtml(html);

      const availability = $('#availability span').first().text().trim().toLowerCase();
      const priceText = $('[data-asin-price]').attr('data-asin-price') ||
                       $('.a-offscreen').first().text() ||
                       $('#price_inside_buybox').text() ||
                       $('#priceblock_ourprice').text();

      let status: StockResult['status'] = 'UNKNOWN';
      if (availability.includes('in stock') || $('#add-to-cart-button').length > 0) {
        status = 'IN_STOCK';
      } else if (
        availability.includes('out of stock') ||
        availability.includes('unavailable') ||
        availability.includes('currently unavailable')
      ) {
        status = 'OUT_OF_STOCK';
      } else if (availability.includes('only') && availability.includes('left')) {
        status = 'LIMITED';
      }

      return {
        storeSlug: this.storeSlug,
        status,
        price: priceText ? this.parsePrice(priceText) : undefined,
        productUrl: cleanUrl,
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
