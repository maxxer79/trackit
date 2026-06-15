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
          message: 'via JSON-LD offers',
        };
      }

      // ── 2. Embedded JS state (Next.js / preloaded state / hydration) ─
      const embedded = this.parseEmbeddedStateDetailed(html);
      if (embedded) {
        return {
          storeSlug: this.storeSlug,
          status: embedded.status,
          price: this.extractPrice($) ?? this.extractPriceFromJson(html),
          productUrl,
          message: `via embedded JSON: ${embedded.detail}`,
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

        // Scan ALL offers (variants/sizes/colors). If ANY variant is
        // buyable the product is buyable — the first listed variant being
        // sold out (common on Kohl's etc.) must not mark the product OOS.
        let sawOos = false;
        let sawPre = false;
        let sawLimited = false;
        let sawIn = false;

        for (const offer of offers) {
          const avail: string = String(offer?.availability ?? '').toLowerCase();
          if (!avail) continue;

          if (avail.includes('limitedavailability')) sawLimited = true;
          else if (avail.includes('instock')) sawIn = true;
          else if (avail.includes('preorder') || avail.includes('presale')) sawPre = true;
          else if (
            avail.includes('outofstock') ||
            avail.includes('soldout') ||
            avail.includes('discontinued') ||
            avail.includes('backorder')
          ) sawOos = true;

          const p = parseFloat(offer?.price ?? offer?.lowPrice ?? '');
          if (!isNaN(p) && p > 0 && price === undefined) price = p;
        }

        if (sawIn) status = 'IN_STOCK';
        else if (sawLimited) status = 'LIMITED';
        else if (sawPre) status = 'PREORDER';
        else if (sawOos) status = 'OUT_OF_STOCK';

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
    // Hydration JSON contains MANY products (recommendations, carousels).
    // The main product's data appears first in the document, so the
    // EARLIEST match wins — checking patterns in a fixed order made a
    // related item's "OUT_OF_STOCK" beat the main item's "inStock":true
    // (false OOS on LG / Home Depot / Kohl's style pages).
    const patterns: Array<[RegExp, Status]> = [
      [/"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?InStock"/i, 'IN_STOCK'],
      [/"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?OutOfStock"/i, 'OUT_OF_STOCK'],
      [/"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?PreOrder"/i, 'PREORDER'],
      [/"availabilityStatus"\s*:\s*"IN_STOCK"/i, 'IN_STOCK'],
      [/"availabilityStatus"\s*:\s*"OUT_OF_STOCK"/i, 'OUT_OF_STOCK'],
      [/"availability_status"\s*:\s*"PRE_ORDER_SELLABLE"/i, 'PREORDER'],
      [/"availability_status"\s*:\s*"PRE_ORDER_UNSELLABLE"/i, 'OUT_OF_STOCK'],
      [/"availability_status"\s*:\s*"IN_STOCK"/i, 'IN_STOCK'],
      [/"availability_status"\s*:\s*"OUT_OF_STOCK"/i, 'OUT_OF_STOCK'],
      [/"inStock"\s*:\s*true/i, 'IN_STOCK'],
      [/"inStock"\s*:\s*false/i, 'OUT_OF_STOCK'],
      [/"purchasable"\s*:\s*true/i, 'IN_STOCK'],
      [/"purchasable"\s*:\s*false/i, 'OUT_OF_STOCK'],
      [/"is_available"\s*:\s*true/i, 'IN_STOCK'],
      [/"is_available"\s*:\s*false/i, 'OUT_OF_STOCK'],
      // Best Buy embeds availability as button state in hydration JSON
      [/"buttonState"\s*:\s*"ADD_TO_CART"/i, 'IN_STOCK'],
      [/"buttonState"\s*:\s*"SOLD_OUT"/i, 'OUT_OF_STOCK'],
      [/"buttonState"\s*:\s*"PRE_ORDER"/i, 'PREORDER'],
    ];

    let bestIdx = Infinity;
    let best: Status | null = null;
    for (const [re, st] of patterns) {
      const idx = html.search(re);
      if (idx >= 0 && idx < bestIdx) {
        bestIdx = idx;
        best = st;
      }
    }
    return best;
  }

  /**
   * Like parseEmbeddedState, but also reports WHICH snippet decided —
   * including surrounding context so false reads can be traced to the
   * exact product/SKU entry inside hydration JSON.
   */
  private parseEmbeddedStateDetailed(html: string): { status: Status; detail: string } | null {
    const status = this.parseEmbeddedState(html);
    if (!status) return null;

    // Re-find the winning index for context (same logic as parseEmbeddedState)
    const allPatterns: RegExp[] = [
      /"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?(?:InStock|OutOfStock|PreOrder)"/i,
      /"availabilityStatus"\s*:\s*"(?:IN_STOCK|OUT_OF_STOCK)"/i,
      /"availability_status"\s*:\s*"(?:PRE_ORDER_SELLABLE|PRE_ORDER_UNSELLABLE|IN_STOCK|OUT_OF_STOCK)"/i,
      /"inStock"\s*:\s*(?:true|false)/i,
      /"purchasable"\s*:\s*(?:true|false)/i,
      /"is_available"\s*:\s*(?:true|false)/i,
      /"buttonState"\s*:\s*"(?:ADD_TO_CART|SOLD_OUT|PRE_ORDER)"/i,
    ];
    let bestIdx = Infinity;
    for (const re of allPatterns) {
      const idx = html.search(re);
      if (idx >= 0 && idx < bestIdx) bestIdx = idx;
    }
    if (bestIdx === Infinity) return { status, detail: 'unknown position' };

    const context = html
      .slice(Math.max(0, bestIdx - 120), bestIdx + 80)
      .replace(/\s+/g, ' ')
      .replace(/</g, '‹')
      .trim();
    return { status, detail: `@${bestIdx} …${context}…` };
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
