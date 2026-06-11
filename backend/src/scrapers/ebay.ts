import axios from 'axios';
import { BaseScraper, StockResult } from './base';
import { fetchRenderedHtml } from './browserFetch';

/**
 * eBay Scraper
 *
 * eBay individual listing URLs expire when an item sells, so we use
 * persistent eBay search URLs instead (e.g. https://www.ebay.com/sch/i.html?_nkw=rtx+4090).
 *
 * Stock logic:
 *   IN_STOCK     = at least 1 active Buy It Now listing found
 *   OUT_OF_STOCK = 0 active listings found (verified genuine empty results)
 *   UNKNOWN      = blocked / markup unrecognized — keep last known status
 *
 * The scraper automatically appends LH_BIN=1 (Buy It Now filter) to exclude
 * auctions and only track fixed-price listings.
 *
 * Strategies: RSS (mostly dead) → plain HTML → FlareSolverr/headless browser.
 * Listing detection is layout-independent: it counts unique /itm/{id} product
 * links, falling back from CSS classes eBay keeps redesigning.
 */
export class EbayScraper extends BaseScraper {
  constructor() {
    super('ebay');
  }

  async checkStock(productUrl: string, _storeProductId?: string): Promise<StockResult> {
    const searchUrl = this.ensureBuyItNow(productUrl);

    // --- Strategy 1: RSS feed (mostly dead, but free to try) ---
    try {
      const result = await this.checkViaRss(searchUrl, productUrl);
      if (result.status !== 'UNKNOWN') {
        return result;
      }
    } catch (rssError: any) {
      console.log(`[eBay] RSS attempt failed: ${rssError.message}`);
    }

    // --- Strategy 2: plain HTML scraping ---
    try {
      const result = await this.checkViaHtml(searchUrl, productUrl);
      if (result.status !== 'UNKNOWN') {
        return result;
      }
    } catch (error: any) {
      console.log(`[eBay] HTML attempt failed: ${error.message}`);
    }

    // --- Strategy 3: FlareSolverr / headless Chromium (shared queue) ---
    try {
      return await this.checkViaRendered(searchUrl, productUrl);
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
        'User-Agent': 'Mozilla/5.0 (compatible; Trackit/1.0; +https://github.com/)',
        Accept: 'application/rss+xml, text/xml, application/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
    });

    const xml: string =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    const itemMatches = xml.match(/<item>/gi);
    const count = itemMatches ? itemMatches.length : 0;
    console.log(`[eBay] RSS size=${xml.length}, item count: ${count}`);

    if (!xml.includes('<rss') && !xml.includes('<channel')) {
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
  // Strategy 2: plain HTML
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

    if (this.isBotBlocked(html)) {
      console.log('[eBay] HTML response is a bot-block/challenge page');
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl: originalUrl,
        message: 'eBay served a bot-challenge page',
      };
    }

    return this.parseResults(html, originalUrl);
  }

  // ---------------------------------------------------------------------------
  // Strategy 3: FlareSolverr / headless Chromium via shared queue
  // ---------------------------------------------------------------------------

  private async checkViaRendered(searchUrl: string, originalUrl: string): Promise<StockResult> {
    const html = await fetchRenderedHtml(searchUrl);
    if (!html) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl: originalUrl,
        message: 'Browser/FlareSolverr fetch failed',
      };
    }
    if (this.isBotBlocked(html)) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl: originalUrl,
        message: 'Bot-challenge even via rendered fetch',
      };
    }
    return this.parseResults(html, originalUrl);
  }

  // ---------------------------------------------------------------------------
  // Shared results parsing (works on plain or rendered HTML)
  // ---------------------------------------------------------------------------

  private parseResults(html: string, originalUrl: string): StockResult {
    const $ = this.loadHtml(html);

    const bodySnippet = $('body').text().slice(0, 200).replace(/\s+/g, ' ').trim();
    console.log(`[eBay] Body snippet: ${bodySnippet}`);

    // eBay is rolling out a new results layout (.s-card) alongside the old
    // one (.s-item) — support both, plus data-attribute fallbacks.
    const ITEM_SEL = '.s-item, .s-card, li[data-listingid], [data-testid="item-card"]';
    const TITLE_SEL = '.s-item__title, .s-card__title, [role="heading"]';

    const listingItems = $(ITEM_SEL).filter((_i, el) => {
      const title = $(el).find(TITLE_SEL).first().text().trim();
      return title.length > 0 && title !== 'Shop on eBay';
    });

    let count = listingItems.length;
    let lowestPrice = count > 0 ? this.extractLowestPriceFromHtml($, listingItems) : undefined;

    if (count === 0) {
      // CSS classes failed — fall back to counting product LINKS. Every
      // real listing links to /itm/{id}; eBay can redesign classes but
      // not their listing URLs. Layout-independent.
      const linkCount = this.countItmLinks($);
      console.log(`[eBay] class-based count: 0, /itm/ link count: ${linkCount}`);
      if (linkCount > 0) {
        count = linkCount;
        lowestPrice = this.extractLowestPriceFromHtml($, $('body'));
      }
    }

    console.log(`[eBay] Listing count: ${count}`);

    if (count === 0) {
      if (this.isGenuineEmptyResults(html)) {
        return {
          storeSlug: this.storeSlug,
          status: 'OUT_OF_STOCK',
          productUrl: originalUrl,
          message: 'No active Buy It Now listings found',
        };
      }
      console.log('[eBay] 0 items but page not verified as empty-results — UNKNOWN');
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl: originalUrl,
        message: 'Could not verify listing count (markup change or partial block)',
      };
    }

    return {
      storeSlug: this.storeSlug,
      status: 'IN_STOCK',
      price: lowestPrice,
      productUrl: originalUrl,
      message: `${count} active listing${count === 1 ? '' : 's'} found`,
    };
  }

  /**
   * Count unique /itm/{id} listing links — layout-independent listing
   * detection. Excludes eBay's placeholder links (short dummy IDs).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private countItmLinks($: any): number {
    const ids = new Set<string>();
    $('a[href*="/itm/"]').each((_i: number, el: any) => {
      const href = $(el).attr('href') ?? '';
      const m = href.match(/\/itm\/(\d{9,})/);
      if (m) ids.add(m[1]);
    });
    return ids.size;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractLowestPriceFromHtml($: any, items: any): number | undefined {
    let lowest: number | undefined;

    items.each((_i: number, el: any) => {
      const priceText = $(el).find('.s-item__price, .s-card__price, [class*="price"]').first().text().trim();
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

  /**
   * A genuine eBay "no results" page contains explicit markers. A bot-block
   * or markup change does not — those must NOT be reported as out of stock.
   */
  private isGenuineEmptyResults(html: string): boolean {
    const t = html.toLowerCase();
    return (
      t.includes('did not match any') ||
      t.includes('no exact matches found') ||
      t.includes('srp-save-null-search') ||
      t.includes('>0 results') ||
      t.includes('0 results for')
    );
  }
}
