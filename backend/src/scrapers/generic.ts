/**
 * Generic HTML scraper for stores without custom implementations.
 *
 * Detection priority (most → least reliable):
 *   1. Bot-block / JS-shell detection        → UNKNOWN (never flips status)
 *   2. JSON-LD structured data (incl. arrays, @graph, offers arrays)
 *   3. Embedded JS state ("inStock":true, "availability":"InStock", etc.)
 *   4. itemprop/meta availability microdata
 *   5. DOM button + text signals — conflicting signals return UNKNOWN
 *      instead of letting a stray "out of stock" string anywhere on the
 *      page (related items, FAQs, script bundles) override a live
 *      Add-to-Cart button.
 */
import { BaseScraper, StockResult } from './base';

type Status = StockResult['status'];

export class GenericScraper extends BaseScraper {
  constructor(storeSlug: string) {
    super(storeSlug);
  }

  async checkStock(productUrl: string): Promise<StockResult> {
    try {
      const html = await this.fetchPage(productUrl);

      // ── 1. Bot-block / shell detection ─────────────────────────────────
      if (this.isBotBlocked(html)) {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: 'Bot-block or empty shell page — status not determinable',
        };
      }

      const $ = this.loadHtml(html);

      // ── 2. JSON-LD structured data ──────────────────────────────────────
      const schema = this.parseJsonLd($);
      if (schema.status) {
        return {
          storeSlug: this.storeSlug,
          status: schema.status,
          price: schema.price ?? this.extractPrice($),
          productUrl,
        };
      }

      // ── 3. Embedded JS state (Next.js / preloaded state / hydration) ───
      const embedded = this.parseEmbeddedState(html);
      if (embedded) {
        return {
          storeSlug: this.storeSlug,
          status: embedded,
          price: this.extractPrice($),
          productUrl,
        };
      }

      // ── 4. Microdata / meta availability ───────────────────────────────
      const micro = this.parseMicrodata($);
      if (micro) {
        return {
          storeSlug: this.storeSlug,
          status: micro,
          price: this.extractPrice($),
          productUrl,
        };
      }

      // ── 5. DOM signals (least reliable — conservative) ─────────────────
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
      let enabledCartBtn = false;
      let disabledCartBtn = false;
      let oosButton = false;

      $('button, a, input[type="submit"], [role="button"], [class*="add-to-cart"], [data-action="add-to-cart"]').each(
        (_i: number, el: any) => {
          const text = ($(el).text() || $(el).attr('value') || '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (!text || text.length > 80) return; // skip empty / giant containers
          const disabled =
            $(el).is('[disabled]') ||
            $(el).attr('aria-disabled') === 'true' ||
            /\bdisabled\b/.test($(el).attr('class') ?? '');

          const isBuy = /(add to cart|add to bag|add to basket|buy now)/.test(text);
          const isOos = /(notify me|email me when|out of stock|sold out|unavailable)/.test(text);

          // A variation link like "Damaged SOLD OUT" is both a link and
          // mentions sold out — only count it as an OOS *button* when it's
          // short and purely an availability label, not a nav/variation link.
          if (isBuy && !isOos) {
            if (disabled) disabledCartBtn = true;
            else enabledCartBtn = true;
          } else if (isOos && /^(notify me( when available)?|email me when available|out of stock|sold out|currently unavailable)$/.test(text)) {
            oosButton = true;
          }
        }
      );

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
        price: this.extractPrice($),
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
    if (/"inStock"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"inStock"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';
    if (/"purchasable"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"purchasable"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';
    if (/"is_available"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"is_available"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';
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
}
