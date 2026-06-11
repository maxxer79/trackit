/**
 * Generic HTML scraper for stores without custom implementations.
 *
 * Fetch strategy:
 *   1. Plain HTTP fetch (fast, cheap)
 *   2. If the store blocks us (HTTP 403/429/503, bot-challenge page, or a
 *      JS-only shell) or we couldn't find any stock signal → retry with a
 *      real headless Chromium browser + stealth (looks like a customer).
 *
 * Detection priority (most → least reliable):
 *   1. Bot-block / JS-shell detection        → UNKNOWN (never flips status)
 *   2. JSON-LD structured data (incl. arrays, @graph, offers arrays)
 *   3. Embedded JS state ("inStock":true, "availability":"InStock", etc.)
 *   4. itemprop/meta availability microdata
 *   5. DOM button + text signals — case-insensitive, conflicting signals
 *      return UNKNOWN instead of letting a stray "sold out" string anywhere
 *      on the page (other variations, related items, FAQs) override a live
 *      Add-to-Cart button.
 */
import { BaseScraper, StockResult } from './base';
import { fetchRenderedHtml } from './browserFetch';

type Status = StockResult['status'];

export class GenericScraper extends BaseScraper {
  constructor(storeSlug: string) {
    super(storeSlug);
  }

  async checkStock(productUrl: string): Promise<StockResult> {
    let html: string | null = null;
    let plainFetchError: string | null = null;

    // ── Attempt 1: plain HTTP ────────────────────────────────────────────
    try {
      html = await this.fetchPage(productUrl);
    } catch (error: any) {
      const httpStatus = error?.response?.status;
      plainFetchError = httpStatus ? `HTTP ${httpStatus}` : error.message;
      // 403/429/503 (or network refusal) = bot protection → browser fallback.
      // Genuine 404 means a dead product link — report UNKNOWN, no browser.
      if (httpStatus === 404) {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: 'Product page returned 404 (dead link?)',
        };
      }
    }

    if (html && !this.isBotBlocked(html)) {
      const result = this.detect(html, productUrl);
      if (result.status !== 'UNKNOWN') {
        return result;
      }
    }

    // ── Attempt 2: headless Chromium + stealth ───────────────────────────
    const rendered = await this.fetchViaBrowser(productUrl);
    if (!rendered) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: plainFetchError
          ? `Blocked (${plainFetchError}) and browser fetch failed`
          : 'No stock signals found and browser fetch failed',
      };
    }
    if (this.isBotBlocked(rendered)) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: 'Bot-blocked even via headless browser',
      };
    }

    const result = this.detect(rendered, productUrl);
    if (result.status === 'UNKNOWN' && !result.message) {
      result.message = 'Page rendered but no stock signals recognized';
    }
    return result;
  }

  /** Overridable for tests; delegates to the shared serialized browser queue. */
  protected fetchViaBrowser(url: string): Promise<string | null> {
    return fetchRenderedHtml(url);
  }

  // ── Detection (pure, runs on any HTML) ─────────────────────────────────

  detect(html: string, productUrl: string): StockResult {
    try {
      const $ = this.loadHtml(html);

      // ── 1. JSON-LD structured data ────────────────────────────────────
      const schema = this.parseJsonLd($);
      if (schema.status) {
        return {
          storeSlug: this.storeSlug,
          status: schema.status,
          price: schema.price ?? this.extractPrice($) ?? this.extractPriceFromJson(html),
          productUrl,
        };
      }

      // ── 2. Embedded JS state (Next.js / preloaded state / hydration) ─
      const embedded = this.parseEmbeddedState(html);
      if (embedded) {
        return {
          storeSlug: this.storeSlug,
          status: embedded,
          price: this.extractPrice($) ?? this.extractPriceFromJson(html),
          productUrl,
        };
      }

      // ── 3. Microdata / meta availability ──────────────────────────────
      const micro = this.parseMicrodata($);
      if (micro) {
        return {
          storeSlug: this.storeSlug,
          status: micro,
          price: this.extractPrice($) ?? this.extractPriceFromJson(html),
          productUrl,
        };
      }

      // ── 4. DOM signals (least reliable — conservative) ────────────────
      const bodyText = $('body').text().toLowerCase();

      // JS-rendered SPA shell: page loaded but body has almost no text.
      if (bodyText.replace(/\s+/g, ' ').trim().length < 200) {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: 'JS-rendered page shell — no server-side content',
        };
      }

      // Scan all clickable elements case-INSENSITIVELY (sites like
      // BigBadToyStore render "ADD TO CART" in caps; cheerio :contains is
      // case-sensitive and used to miss it).
      //
      // Record the DOCUMENT-ORDER POSITION of the first signal of each
      // kind. Product pages put the main item's buy area at the top and
      // related-product carousels (full of "Notify Me" buttons — see MSI)
      // below it. The earliest signal belongs to the actual product.
      let buyIdx = -1;
      let disabledIdx = -1;
      let oosIdx = -1;
      let preIdx = -1;

      $('button, a, input[type="submit"], [role="button"], [class*="add-to-cart"], [data-action="add-to-cart"]').each(
        (i: number, el: any) => {
          const text = ($(el).text() || $(el).attr('value') || '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (!text || text.length > 80) return; // skip empty / giant containers
          const disabled =
            $(el).is('[disabled]') ||
            $(el).attr('aria-disabled') === 'true' ||
            /\bdisabled\b/.test($(el).attr('class') ?? '');

          const isBuy = /(add to cart|add to bag|add to basket|buy now)/.test(text);
          const isPre = /^(pre-?order( now)?|pre-?order for shipping|pre-?order for pickup)$/.test(text);
          const isOos = /(notify me|email me when|out of stock|sold out|unavailable)/.test(text);

          // A variation link like "Damaged SOLD OUT" is both a link and
          // mentions sold out — only count it as an OOS *button* when it's
          // purely an availability label, not a nav/variation link.
          if (isBuy && !isOos) {
            if (disabled) { if (disabledIdx < 0) disabledIdx = i; }
            else if (buyIdx < 0) buyIdx = i;
          } else if (isPre && !disabled) {
            if (preIdx < 0) preIdx = i;
          } else if (isOos && /^(notify me( when available)?|email me when available|out of stock|sold out|currently unavailable)$/.test(text)) {
            if (oosIdx < 0) oosIdx = i;
          }
        }
      );

      const before = (a: number, b: number) => a >= 0 && (b < 0 || a < b);
      const enabledCartBtn = before(buyIdx, oosIdx) && before(buyIdx, disabledIdx);
      const preorderBtn = preIdx >= 0 && before(preIdx, oosIdx);
      const oosButton = before(oosIdx, buyIdx) && before(oosIdx, preIdx);
      const disabledCartBtn = before(disabledIdx, buyIdx);

      // "in stock" as standalone text (e.g. BBTS's "IN STOCK" heading) —
      // but never count phrases about FUTURE stock ("back in stock",
      // "when in stock") as positive signals.
      const cleanedText = bodyText
        .replace(/back in stock/g, '')
        .replace(/when in stock/g, '')
        .replace(/once in stock/g, '')
        .replace(/if in stock/g, '');
      const hasInStockText = /\bin stock\b/.test(cleanedText);

      const oosText =
        bodyText.includes('currently unavailable') ||
        bodyText.includes('temporarily out of stock') ||
        bodyText.includes('notify me when available') ||
        bodyText.includes('out of stock') ||
        bodyText.includes('sold out');

      let status: Status = 'UNKNOWN';

      if (enabledCartBtn && !oosButton) {
        // Live purchase button is the strongest DOM signal there is.
        // Do NOT let body-text mentions of "sold out" (other variations,
        // related items, FAQs) override it.
        status = 'IN_STOCK';
      } else if (preorderBtn && !oosButton) {
        // Active Preorder button = buyable preorder (Target etc.)
        status = 'PREORDER';
      } else if (disabledCartBtn || oosButton) {
        status = 'OUT_OF_STOCK';
      } else if (hasInStockText && !oosButton && !disabledCartBtn) {
        // Page explicitly says "IN STOCK" and no OOS button contradicts it
        status = 'IN_STOCK';
      } else if (oosText && !hasInStockText && !enabledCartBtn) {
        status = 'OUT_OF_STOCK';
      }
      // Anything conflicting or signal-free stays UNKNOWN → status preserved.

      return {
        storeSlug: this.storeSlug,
        status,
        price: this.extractPrice($) ?? this.extractPriceFromJson(html),
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

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Parse all JSON-LD blocks. Handles: single objects, arrays, @graph
   * wrappers, and offers as object or array. Returns the availability of
   * the first Product node found.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseJsonLd($: any): { status: Status | null; price?: number } {
    let status: Status | null = null;
    let price: number | undefined;

    $('script[type="application/ld+json"]').each((_i: number, el: any) => {
      if (status) return;
      let parsed: any;
      try {
        parsed = JSON.parse($(el).html() || 'null');
      } catch {
        return;
      }
      if (!parsed) return;

      const nodes: any[] = [];
      const collect = (n: any) => {
        if (!n) return;
        if (Array.isArray(n)) return n.forEach(collect);
        nodes.push(n);
        if (n['@graph']) collect(n['@graph']);
      };
      collect(parsed);

      for (const node of nodes) {
        const offersRaw = node.offers ?? (node['@type'] === 'Offer' ? node : null);
        if (!offersRaw) continue;
        const offers = Array.isArray(offersRaw) ? offersRaw : [offersRaw];

        for (const offer of offers) {
          const avail: string = String(offer?.availability ?? '').toLowerCase();
          if (!avail) continue;

          if (avail.includes('instock') || avail.includes('limitedavailability')) {
            status = avail.includes('limited') ? 'LIMITED' : 'IN_STOCK';
          } else if (
            avail.includes('outofstock') ||
            avail.includes('soldout') ||
            avail.includes('discontinued')
          ) {
            status = 'OUT_OF_STOCK';
          } else if (avail.includes('preorder') || avail.includes('presale')) {
            status = 'PREORDER';
          } else if (avail.includes('backorder')) {
            status = 'OUT_OF_STOCK';
          }

          const p = parseFloat(offer?.price ?? offer?.lowPrice ?? '');
          if (!isNaN(p) && p > 0) price = p;
          if (status) break;
        }
        if (status) break;
      }
    });

    return { status, price };
  }

  /**
   * Scan raw HTML for availability values embedded in hydration JSON
   * (Next.js __NEXT_DATA__, Redux preloaded state, Shopify metadata, etc.)
   */
  private parseEmbeddedState(html: string): Status | null {
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?InStock"/i.test(html)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?OutOfStock"/i.test(html)) return 'OUT_OF_STOCK';
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?PreOrder"/i.test(html)) return 'PREORDER';
    if (/"availabilityStatus"\s*:\s*"IN_STOCK"/i.test(html)) return 'IN_STOCK';
    if (/"availabilityStatus"\s*:\s*"OUT_OF_STOCK"/i.test(html)) return 'OUT_OF_STOCK';
    // Target-style snake_case variants (PRE_ORDER_SELLABLE = buyable preorder)
    if (/"availability_status"\s*:\s*"PRE_ORDER_SELLABLE"/i.test(html)) return 'PREORDER';
    if (/"availability_status"\s*:\s*"PRE_ORDER_UNSELLABLE"/i.test(html)) return 'OUT_OF_STOCK';
    if (/"availability_status"\s*:\s*"IN_STOCK"/i.test(html)) return 'IN_STOCK';
    if (/"availability_status"\s*:\s*"OUT_OF_STOCK"/i.test(html)) return 'OUT_OF_STOCK';
    if (/"inStock"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"inStock"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';
    if (/"purchasable"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"purchasable"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';
    if (/"is_available"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"is_available"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';
    // Best Buy embeds availability as button state in hydration JSON
    if (/"buttonState"\s*:\s*"ADD_TO_CART"/i.test(html)) return 'IN_STOCK';
    if (/"buttonState"\s*:\s*"SOLD_OUT"/i.test(html)) return 'OUT_OF_STOCK';
    if (/"buttonState"\s*:\s*"PRE_ORDER"/i.test(html)) return 'PREORDER';
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseMicrodata($: any): Status | null {
    const avail = (
      $('[itemprop="availability"]').attr('content') ||
      $('[itemprop="availability"]').attr('href') ||
      $('link[itemprop="availability"]').attr('href') ||
      ''
    ).toLowerCase();
    if (!avail) return null;
    if (avail.includes('instock')) return 'IN_STOCK';
    if (avail.includes('outofstock') || avail.includes('soldout')) return 'OUT_OF_STOCK';
    if (avail.includes('preorder')) return 'PREORDER';
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractPrice($: any): number | undefined {
    const priceText =
      $('[itemprop="price"]').attr('content') ||
      $('meta[property="product:price:amount"]').attr('content') ||
      $('[itemprop="price"]').first().text() ||
      $('[class*="price"]').first().text();
    return priceText ? this.parsePrice(priceText) : undefined;
  }

  /**
   * Last-resort price from hydration JSON — keeps prices fresh even when
   * the DOM has no parseable price element.
   */
  protected extractPriceFromJson(html: string): number | undefined {
    const m = html.match(
      /"(?:current_retail|currentPrice|customerPrice|salePrice|finalPrice|price)"\s*:\s*"?(\d{1,6}(?:\.\d{1,2})?)"?/i
    );
    if (m) {
      const p = parseFloat(m[1]);
      if (!isNaN(p) && p > 0) return p;
    }
    return undefined;
  }
}
