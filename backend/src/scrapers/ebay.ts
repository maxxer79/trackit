import { BaseScraper, StockResult } from './base';

/**
 * eBay Scraper
 *
 * eBay individual listing URLs expire when an item sells, so we use
 * persistent eBay search URLs instead (e.g. https://www.ebay.com/sch/i.html?_nkw=rtx+4090).
 *
 * Stock logic:
 *   IN_STOCK     = at least 1 active Buy It Now listing found in search results
 *   OUT_OF_STOCK = 0 active listings found
 *
 * The scraper automatically appends LH_BIN=1 (Buy It Now filter) to exclude
 * auctions and only track fixed-price listings.
 */
export class EbayScraper extends BaseScraper {
  constructor() {
    super('ebay');
  }

  async checkStock(productUrl: string, _storeProductId?: string): Promise<StockResult> {
    try {
      const searchUrl = this.ensureBuyItNow(productUrl);
      return await this.checkViaSearch(searchUrl, productUrl);
    } catch (error: any) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: error.message,
      };
    }
  }

  /**
   * Append LH_BIN=1 (Buy It Now) to the URL if it's not already present.
   * This filters out auction-only listings so we only track fixed-price inventory.
   */
  private ensureBuyItNow(url: string): string {
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('LH_BIN')) {
        parsed.searchParams.set('LH_BIN', '1');
      }
      return parsed.toString();
    } catch {
      // If URL parsing fails, append manually
      const separator = url.includes('?') ? '&' : '?';
      return url.includes('LH_BIN') ? url : `${url}${separator}LH_BIN=1`;
    }
  }

  private async checkViaSearch(searchUrl: string, originalUrl: string): Promise<StockResult> {
    const html = await this.fetchPage(searchUrl);
    const $ = this.loadHtml(html);

    // eBay search result items are in <li> elements with class "s-item"
    // The first .s-item is often a ghost/template element — filter it out by
    // checking for the presence of a real title or price inside it.
    const listingItems = $('.s-item').filter((_i, el) => {
      const title = $(el).find('.s-item__title').text().trim();
      // eBay injects a dummy "Shop on eBay" item as the first result
      return title.length > 0 && title !== 'Shop on eBay';
    });

    const count = listingItems.length;

    if (count === 0) {
      return {
        storeSlug: this.storeSlug,
        status: 'OUT_OF_STOCK',
        productUrl: originalUrl,
        message: 'No active Buy It Now listings found',
      };
    }

    // Extract the lowest listed price from the visible results
    const lowestPrice = this.extractLowestPrice($, listingItems);

    return {
      storeSlug: this.storeSlug,
      status: 'IN_STOCK',
      price: lowestPrice,
      productUrl: originalUrl,
      message: `${count} active listing${count === 1 ? '' : 's'} found`,
    };
  }

  private extractLowestPrice($: cheerio.CheerioAPI, items: cheerio.Cheerio<any>): number | undefined {
    let lowest: number | undefined;

    items.each((_i, el) => {
      // Price can appear as a plain value or as a range (e.g. "$249.99 to $399.99")
      // .s-item__price contains the price text
      const priceText = $(el).find('.s-item__price').first().text().trim();
      if (!priceText) return;

      // Handle range prices — take the lower bound
      const rangeMatch = priceText.match(/\$([\d,]+\.?\d*)\s+to\s+\$([\d,]+\.?\d*)/i);
      if (rangeMatch) {
        const low = parseFloat(rangeMatch[1].replace(/,/g, ''));
        if (!isNaN(low) && (lowest === undefined || low < lowest)) {
          lowest = low;
        }
        return;
      }

      const parsed = this.parsePrice(priceText);
      if (parsed !== undefined && (lowest === undefined || parsed < lowest)) {
        lowest = parsed;
      }
    });

    return lowest;
  }
}
