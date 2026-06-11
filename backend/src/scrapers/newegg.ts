import axios from 'axios';
import { BaseScraper, StockResult } from './base';

export class NeweggScraper extends BaseScraper {
  constructor() {
    super('newegg');
  }

  async checkStock(productUrl: string): Promise<StockResult> {
    // Newegg exposes a realtime product JSON endpoint keyed by the item
    // number in /p/{ItemNumber} URLs — much more reliable than HTML when
    // it responds. Falls through silently if blocked.
    const itemNumber = productUrl.match(/\/p\/([0-9A-Z]{2,4}-[0-9A-Z]{3,5}-[0-9A-Z]{3,6})/i)?.[1];
    if (itemNumber) {
      try {
        const { data } = await axios.get(
          `https://www.newegg.com/product/api/ProductRealtime?ItemNumber=${encodeURIComponent(itemNumber)}`,
          {
            timeout: 12000,
            headers: {
              'User-Agent': this.userAgent,
              Accept: 'application/json',
              Referer: productUrl,
            },
          }
        );
        const main = data?.MainItem ?? data;
        const instock = main?.Instock ?? main?.InStock ?? data?.Instock;
        const price = parseFloat(main?.FinalPrice ?? main?.UnitCost ?? '');
        if (instock === true) {
          return { storeSlug: this.storeSlug, status: 'IN_STOCK', price: isNaN(price) ? undefined : price, productUrl };
        }
        if (instock === false) {
          return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
        }
      } catch {
        // API blocked — fall through to HTML
      }
    }

    try {
      const html = await this.fetchPage(productUrl);

      // Newegg "Are you a human?" page → UNKNOWN
      if (this.isBotBlocked(html)) {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: 'Newegg served a bot-challenge page',
        };
      }

      // Embedded JSON state — most reliable in Newegg SSR output
      if (/"instock"\s*:\s*true/i.test(html)) {
        const $$ = this.loadHtml(html);
        const p = $$('.price-current').first().text();
        return { storeSlug: this.storeSlug, status: 'IN_STOCK', price: p ? this.parsePrice(p) : undefined, productUrl };
      }
      if (/"instock"\s*:\s*false/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
      }

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
