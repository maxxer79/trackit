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

    // --- Strategy 3: headless Chromium + stealth (beats bot detection) ---
    try {
      return await this.checkViaPuppeteer(searchUrl, productUrl);
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

    // Bot-block / challenge page — we learned NOTHING. Returning
    // OUT_OF_STOCK here was the source of false "out of stock" flips.
    if (this.isBotBlocked(html)) {
      console.log('[eBay] HTML response is a bot-block/challenge page');
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl: originalUrl,
        message: 'eBay served a bot-challenge page',
      };
    }

    const $ = this.loadHtml(html);

    const bodySnippet = $('body').text().slice(0, 200).replace(/\s+/g, ' ').trim();
    console.log(`[eBay] HTML body snippet: ${bodySnippet}`);

    // eBay is rolling out a new results layout (.s-card) alongside the old
    // one (.s-item) — support both, plus data-attribute fallbacks.
    const ITEM_SEL = '.s-item, .s-card, li[data-listingid], [data-testid="item-card"]';
    const TITLE_SEL = '.s-item__title, .s-card__title, [role="heading"]';
    console.log(`[eBay] HTML item count: ${$(ITEM_SEL).length}`);

    const listingItems = $(ITEM_SEL).filter((_i, el) => {
      const title = $(el).find(TITLE_SEL).first().text().trim();
      return title.length > 0 && title !== 'Shop on eBay';
    });

    const count = listingItems.length;

    if (count === 0) {
      // Only report OUT_OF_STOCK if this is verifiably a genuine empty
      // results page. Otherwise eBay changed markup or partially blocked
      // us — return UNKNOWN so the stored status is preserved.
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

  // ---------------------------------------------------------------------------
  // Strategy 3: headless Chromium + stealth plugin
  // ---------------------------------------------------------------------------

  private async checkViaPuppeteer(searchUrl: string, originalUrl: string): Promise<StockResult> {
    if (EbayScraper.browserBusy) {
      console.log('[eBay] Browser busy — skipping Puppeteer fallback');
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl: originalUrl, message: 'Browser busy' };
    }
    EbayScraper.browserBusy = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let browser: any;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const puppeteerExtra = require('puppeteer-extra');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteerExtra.use(StealthPlugin());

      browser = await puppeteerExtra.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
          '--disable-gpu', '--window-size=1280,800',
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );

      console.log(`[eBay] Puppeteer (stealth) fetching: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise<void>((r) => setTimeout(r, 3000));

      const result = await page.evaluate(() => {
        // Old (.s-item) and new (.s-card) eBay results layouts + fallbacks
        const items = Array.from(
          document.querySelectorAll('.s-item, .s-card, li[data-listingid], [data-testid="item-card"]')
        );
        const realItems = items.filter((el) => {
          const title = el.querySelector('.s-item__title, .s-card__title, [role="heading"]');
          const text = title?.textContent?.trim() ?? '';
          return text.length > 0 && text !== 'Shop on eBay';
        });
        const bodyText = document.body.innerText.toLowerCase();
        const genuineEmpty =
          bodyText.includes('did not match any') ||
          bodyText.includes('no exact matches found') ||
          bodyText.includes('0 results');
        const blocked =
          bodyText.includes('pardon our interruption') ||
          bodyText.includes('verify yourself') ||
          bodyText.includes('reference id');
        // Lowest price among real items
        let lowest: number | undefined;
        for (const el of realItems) {
          const txt =
            el.querySelector('.s-item__price, .s-card__price, [class*="price"]')?.textContent ?? '';
          const m = txt.match(/\$([\d,]+\.?\d*)/);
          if (m) {
            const p = parseFloat(m[1].replace(/,/g, ''));
            if (!isNaN(p) && p > 0 && (lowest === undefined || p < lowest)) lowest = p;
          }
        }
        return { count: realItems.length, genuineEmpty, blocked, lowest };
      });

      console.log(`[eBay] Puppeteer found ${result.count} listing(s), blocked=${result.blocked}`);

      if (result.blocked) {
        return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl: originalUrl, message: 'Bot-challenge even via headless browser' };
      }
      if (result.count > 0) {
        return {
          storeSlug: this.storeSlug,
          status: 'IN_STOCK',
          price: result.lowest,
          productUrl: originalUrl,
          message: `${result.count} active listing${result.count === 1 ? '' : 's'} found`,
        };
      }
      if (result.genuineEmpty) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl: originalUrl, message: 'No active Buy It Now listings found' };
      }
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl: originalUrl, message: 'Rendered page had no recognizable results markup' };
    } finally {
      EbayScraper.browserBusy = false;
      if (browser) await browser.close().catch(() => {});
    }
  }

  private static browserBusy = false;
}
