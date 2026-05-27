/**
 * Generic HTML scraper for stores without custom implementations.
 * Uses common patterns to detect stock status.
 */
import { BaseScraper, StockResult } from './base';

export class GenericScraper extends BaseScraper {
  constructor(storeSlug: string) {
    super(storeSlug);
  }

  async checkStock(productUrl: string): Promise<StockResult> {
    try {
      const html = await this.fetchPage(productUrl);
      const $ = this.loadHtml(html);
      const bodyText = $('body').text().toLowerCase();

      // Common "in stock" signals
      const inStockSignals = [
        $('button:contains("Add to Cart")').length > 0,
        $('button:contains("Add to Bag")').length > 0,
        $('button:contains("Buy Now")').length > 0,
        $('[class*="add-to-cart"]:not([disabled])').length > 0,
        $('[data-action="add-to-cart"]').length > 0,
        bodyText.includes('"availability": "https://schema.org/instock"'),
        $('[itemprop="availability"][content="InStock"]').length > 0,
        $('[itemprop="availability"][href*="InStock"]').length > 0,
      ];

      // Common "out of stock" signals
      const outOfStockSignals = [
        bodyText.includes('out of stock'),
        bodyText.includes('sold out'),
        bodyText.includes('currently unavailable'),
        bodyText.includes('notify me when available'),
        $('[class*="out-of-stock"]').length > 0,
        $('[class*="sold-out"]').length > 0,
        $('button:contains("Notify Me")').length > 0,
        $('button[disabled]:contains("Add to Cart")').length > 0,
        $('[itemprop="availability"][content="OutOfStock"]').length > 0,
      ];

      // JSON-LD structured data check
      const jsonLdScripts = $('script[type="application/ld+json"]');
      let schemaStatus: string | null = null;
      jsonLdScripts.each((_i, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}');
          const availability = json?.offers?.availability || json?.availability;
          if (availability) {
            schemaStatus = availability.toLowerCase().includes('instock') ? 'IN_STOCK' :
                          availability.toLowerCase().includes('outofstock') ? 'OUT_OF_STOCK' :
                          availability.toLowerCase().includes('preorder') ? 'PREORDER' : null;
          }
        } catch {}
      });

      if (schemaStatus) {
        const priceText = $('[itemprop="price"]').attr('content') || $('[itemprop="price"]').text();
        return {
          storeSlug: this.storeSlug,
          status: schemaStatus as StockResult['status'],
          price: priceText ? this.parsePrice(priceText) : undefined,
          productUrl,
        };
      }

      const isInStock = inStockSignals.some(Boolean);
      const isOutOfStock = outOfStockSignals.some(Boolean);

      let status: StockResult['status'] = 'UNKNOWN';
      if (isInStock && !isOutOfStock) status = 'IN_STOCK';
      else if (isOutOfStock) status = 'OUT_OF_STOCK';

      const priceText = $('[itemprop="price"]').attr('content') ||
                       $('[class*="price"]').first().text();

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
