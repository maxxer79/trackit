import axios from 'axios';
import { BaseScraper, StockResult } from './base';

/**
 * eBay Scraper
 *
 * eBay individual listing URLs expire when an item sells, so we use
 * persistent eBay search URLs instead (e.g. https://www.ebay.com/sch/i.html?_nkw=rtx+4090).
 *
 * Stock logic:
 *   IN_STOCK     = at least 1 active Buy It Now listing found
 *   OUT_OF_STOCK = 0 active listings found
 *
 * The scraper automatically appends LH_BIN=1 (Buy It Now filter) to exclude
 * auctions and only track fixed-price listings.
 *
 * Strategy: try RSS feed first (less bot-detection), fall back to HTML scraping.
 */
export class EbayScraper extends BaseScraper {
  constructor() {
    super('ebay');
  }

  async checkStock(productUrl: string, _storeProductId?: string): Promise<StockResult> {
    const searchUrl = this.ensureBuyItNow(productUrl);

    // --- Strategy 1: RSS feed (programmatic, less bot detection) ---
    try {
      const result = await this.checkViaRss(searchUrl, productUrl);
      if (result.status !== 'UNKNOWN') {
        return result;
      }
    } catch (rssError: any) {
      console.log(`[eBay] RSS attempt failed: ${rssError.message}`);
    }

    // --- Strategy 2: HTML scraping fallback ---
    try {
      return await this.checkViaHtml(searchUrl, productUrl);
    } catch (error: any) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: `All fetch strategies failed: ${error.message}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Append LH_BIN=1 (Buy It Now) to the URL if not already present.
   */
  private ensureBuyItNow(url: string): string {
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('LH_BIN')) {
        parsed.searchParams.set('LH_BIN', '1');
      }
      return parsed.toString();
    } catch {
      const separator = url.includes('?') ? '&' : '?';
      return url.includes('LH_BIN') ? url : `${url}${separator}LH_BIN=1`;
    }
  }

  /**
   * Convert a search URL to its RSS equivalent by appending _rss=1.
   */
  private buildRssUrl(searchUrl: string): string {
    try {
      const parsed = new URL(searchUrl);
      parsed.searchParams.set('_rss', '1');
      return parsed.toString();
    } catch {
      const sep = searchUrl.includes('?') ? '&' : '?';
      return `${searchUrl}${sep}_rss=1`;
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy 1: RSS
  // ---------------------------------------------------------------------------

  private async checkViaRss(searchUrl: string, originalUrl: string): Promise<StockResult> {
    const rssUrl = this.buildRssUrl(searchUrl);
    console.log(`[eBay] Fetching RSS: ${rssUrl}`);

    const response = await axios.get(rssUrl, {
      timeout: 20000,
      headers: {
        // RSS feeds are intended for feed readers — a simple UA is fine
        'User-Agent': 'Mozilla/5.0 (compatible; Trackit/1.0; +https://github.com/)',
        Accept: 'application/rss+xml, text/xml, application/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
    });

    // axios may auto-parse XML to an object; stringify if so
    const xml: string =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    const snippet = xml.slice(0, 300).replace(/\s+/g, ' ').trim();
    console.log(`[eBay] RSS size=${xml.length}, snippet: ${snippet}`);

    // Each eBay listing is an <item> element in the feed
    const itemMatches = xml.match(/<item>/gi);
    const count = itemMatches ? itemMatches.length : 0;
    console.log(`[eBay] RSS item count: ${count}`);

    // If the response looks like a bot-block page (no XML structure), return UNKNOWN
    // so the caller falls through to HTML scraping
    if (!xml.includes('<rss') && !xml.includes('<channel')) {
      console.log('[eBay] RSS response does not look like valid XML — bot block?');
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl: originalUrl,
        message: 'RSS response was not valid XML',
      };
    }

    if (count === 0) {
      return {
        storeSlug: this.storeSlug,
        status: 'OUT_OF_STOCK',
        productUrl: originalUrl,
        message: 'No active Buy It Now listings found',
      };
    }

    const lowestPrice = this.extractPricesFromXml(xml);

    return {
      storeSlug: this.storeSlug,
      status: 'IN_STOCK',
      price: lowestPrice,
      productUrl: originalUrl,
      message: `${count} active listing${count === 1 ? '' : 's'} found`,
    };
  }

  /**
   * Scan RSS XML for all dollar-amount prices and return the lowest.
   * eBay RSS prices appear in <title> as "Item Name $XXX.XX" or in <description>.
   */
  private extractPricesFromXml(xml: string): number | undefined {
    let lowest: number | undefined;
    const priceRegex = /\$([\d,]+\.?\d*)/g;
    let match: RegExpExecArray | null;

    while ((match = priceRegex.exec(xml)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(price) && price > 0) {
        if (lowest === undefined || price < lowest) {
          lowest = price;
        }
      }
    }

    return lowest;
  }

  // ---------------------------------------------------------------------------
  // Strategy 2: HTML scraping
  // ---------------------------------------------------------------------------

  private async checkViaHtml(searchUrl: string, originalUrl: string): Promise<StockResult> {
    console.log(`[eBay] Fetching HTML: ${searchUrl}`);

    const response = await axios.get(searchUrl, {
      timeout: 20000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        Referer: 'https://www.ebay.com/',
      },
      maxRedirects: 5,
    });

    const html: string =
      typeof response.data === 'string' ? response.data : String(response.data);

    const $ = this.loadHtml(html);

    const bodySnippet = $('body').text().slice(0, 200).replace(/\s+/g, ' ').trim();
    console.log(`[eBay] HTML body snippet: ${bodySnippet}`);
    console.log(`[eBay] HTML .s-item count: ${$('.s-item').length}`);

    const listingItems = $('.s-item').filter((_i, el) => {
      const title = $(el).find('.s-item__title').text().trim();
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

    const lowestPrice = this.extractLowestPriceFromHtml($, listingItems);

    return {
      storeSlug: this.storeSlug,
      status: 'IN_STOCK',
      price: lowestPrice,
      productUrl: originalUrl,
      message: `${count} active listing${count === 1 ? '' : 's'} found`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractLowestPriceFromHtml($: any, items: any): number | undefined {
    let lowest: number | undefined;

    items.each((_i: number, el: any) => {
      const priceText = $(el).find('.s-item__price').first().text().trim();
      if (!priceText) return;

      // Handle price ranges — take the lower bound
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
