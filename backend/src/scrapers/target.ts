import { BaseScraper, StockResult } from './base';
import { fetchRenderedHtml } from './browserFetch';
import logger from '../utils/logger';

export class TargetScraper extends BaseScraper {
  constructor() {
    super('target');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      // storeProductId is the DB record id (cuid), NOT a TCIN — only use
      // it if it's actually numeric
      const tcin =
        (storeProductId && /^\d{8,9}$/.test(storeProductId) ? storeProductId : undefined) ||
        productUrl.match(/A-(\d+)/)?.[1];

      if (tcin) {
        // Target Redsky API — requires the public web API key Target's own
        // frontend sends (missing key = 403), plus JSON Accept + Referer
        const apiUrl =
          `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1` +
          `?key=9f36aeafbe60771e321a7cc95a78140772ab3e96` +
          `&tcin=${tcin}&pricing_store_id=3991&has_pricing_store_id=true&visitor_id=0100000000000000&is_bot=false`;
        try {
          const response = await this.client.get(apiUrl, {
            headers: {
              Accept: 'application/json',
              Referer: 'https://www.target.com/',
              Origin: 'https://www.target.com',
            },
          });
          const product = response.data?.data?.product;
          const fulfillment = product?.fulfillment;
          const availability = fulfillment?.shipping_options?.availability_status;
          const price = product?.price?.current_retail;

          logger.info(`[Target TCIN:${tcin}] availability=${availability} preorder=${JSON.stringify(fulfillment?.preorder)}`);

          // is_preorder=true + is_available_for_preorder=true  → PREORDER (button clickable)
          // is_preorder=true + is_available_for_preorder=false → OUT_OF_STOCK (button disabled)
          const isPreorder: boolean =
            fulfillment?.preorder?.is_preorder === true ||
            availability === 'PREORDER';
          const preorderAvailable: boolean =
            fulfillment?.preorder?.is_available_for_preorder !== false;

          let status: StockResult['status'];

          if (availability === 'PRE_ORDER_SELLABLE') {
            status = 'PREORDER';
          } else if (availability === 'PRE_ORDER_UNSELLABLE') {
            status = 'OUT_OF_STOCK';
          } else if (isPreorder) {
            status = preorderAvailable ? 'PREORDER' : 'OUT_OF_STOCK';
          } else if (availability === 'IN_STOCK') {
            status = 'IN_STOCK';
          } else if (
            availability === 'OUT_OF_STOCK' ||
            availability === 'UNAVAILABLE' ||
            availability === 'NOT_SOLD_IN_STORE'
          ) {
            status = 'OUT_OF_STOCK';
          } else if (availability === 'BACKORDER') {
            status = 'OUT_OF_STOCK';
          } else {
            status = 'UNKNOWN';
          }

          return {
            storeSlug: this.storeSlug,
            status,
            price: price ? parseFloat(price) : undefined,
            productUrl,
          };
        } catch (apiErr: any) {
          logger.warn(`[Target] Redsky API failed for TCIN ${tcin}, falling back to HTML: ${apiErr.message}`);
          // Fall through to HTML
        }
      }

      // HTML fallback — check disabled state so pre-order with locked button → OUT_OF_STOCK
      const html = await this.fetchPage(productUrl);

      // Target SSR embeds availability_status (snake_case) in __TGT_DATA__
      // and schema.org JSON-LD availability in the SEO head
      const embedded = this.detectEmbedded(html);
      if (embedded) {
        return { storeSlug: this.storeSlug, status: embedded, productUrl };
      }

      const $ = this.loadHtml(html);

      const outOfStock = $('[data-test="outOfStockMessage"]').length > 0;
      const addToCartBtn = $('button[data-test="addToCartButton"]');
      const btnPresent = addToCartBtn.length > 0;
      const btnDisabled = addToCartBtn.is('[disabled]') || addToCartBtn.attr('disabled') !== undefined;

      logger.info(`[Target HTML] btnPresent=${btnPresent} btnDisabled=${btnDisabled} outOfStock=${outOfStock}`);

      let status: StockResult['status'];
      if (outOfStock) {
        status = 'OUT_OF_STOCK';
      } else if (btnPresent && !btnDisabled) {
        status = 'IN_STOCK';
      } else if (btnPresent && btnDisabled) {
        // Button exists but is disabled → pre-order locked or unavailable
        status = 'OUT_OF_STOCK';
      } else {
        status = 'UNKNOWN';
      }

      if (status !== 'UNKNOWN') {
        return { storeSlug: this.storeSlug, status, productUrl };
      }

      // Target serves a JS shell to plain requests — render the real page
      return await this.checkViaRendered(productUrl);
    } catch (error: any) {
      // Plain fetch failed entirely — try the rendered path before giving up
      try {
        return await this.checkViaRendered(productUrl);
      } catch {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: error.message,
        };
      }
    }
  }

  /**
   * Availability from Target-specific embedded data: __TGT_DATA__
   * availability_status values AND the schema.org JSON-LD that Target
   * server-renders in the page head for SEO (present even in the JS shell).
   */
  private detectEmbedded(html: string): StockResult['status'] | null {
    if (/"availability_status"\s*:\s*"PRE_ORDER_SELLABLE"/i.test(html)) return 'PREORDER';
    if (/"availability_status"\s*:\s*"PRE_ORDER_UNSELLABLE"/i.test(html)) return 'OUT_OF_STOCK';
    if (/"availability_status"\s*:\s*"IN_STOCK"/i.test(html)) return 'IN_STOCK';
    if (/"availability_status"\s*:\s*"OUT_OF_STOCK"/i.test(html)) return 'OUT_OF_STOCK';
    // schema.org JSON-LD in the SEO head
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?PreOrder"/i.test(html)) return 'PREORDER';
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?InStock"/i.test(html)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?OutOfStock"/i.test(html)) return 'OUT_OF_STOCK';
    return null;
  }

  /**
   * FlareSolverr / headless Chromium fallback — renders the real PDP and
   * reads Target-specific signals ONLY (generic text matching on Target's
   * shell caused false out-of-stock readings).
   */
  private async checkViaRendered(productUrl: string): Promise<StockResult> {
    const TARGET_BTN_SELECTOR =
      'button[data-test="addToCartButton"], button[data-test="shippingButton"], [data-test="outOfStockMessage"]';

    // Attempt 1: FlareSolverr (fast, but snapshots before Target's buy
    // button renders about half the time)
    const html = await fetchRenderedHtml(productUrl);
    if (html) {
      const result = this.analyzeRendered(html, productUrl);
      if (result) return result;
    }

    // Attempt 2: local stealth Chromium, explicitly WAITING for Target's
    // buy button / OOS message to render before taking the snapshot
    logger.info('[Target rendered] FlareSolverr snapshot had no signals — retrying with waitSelector');
    const html2 = await fetchRenderedHtml(productUrl, 40000, {
      skipFlareSolverr: true,
      waitSelector: TARGET_BTN_SELECTOR,
    });
    if (html2) {
      const result = this.analyzeRendered(html2, productUrl);
      if (result) return result;
      // Diagnostics: log what availability-ish strings the page DID contain
      const hints = Array.from(new Set([
        ...(html2.match(/"availability[_a-zA-Z]*"\s*:\s*"[A-Za-z_]+"/g) ?? []),
        ...(html2.match(/schema\.org\/[A-Za-z]+/g) ?? []),
      ])).slice(0, 15);
      logger.info(`[Target rendered] still no signals after waitSelector; hints: ${hints.join(' | ') || 'NONE'}`);
    }

    return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'Rendered page had no recognizable Target signals' };
  }

  /** Returns a result when the page carries definitive signals, else null. */
  private analyzeRendered(html: string, productUrl: string): StockResult | null {
    const embedded = this.detectEmbedded(html);
    if (embedded) {
      return { storeSlug: this.storeSlug, status: embedded, productUrl };
    }

    const $ = this.loadHtml(html);
    const outOfStock = $('[data-test="outOfStockMessage"]').length > 0;
    const addBtn = $('button[data-test="addToCartButton"], button[data-test="shippingButton"]');
    const btnText = addBtn.first().text().trim().toLowerCase();
    const btnDisabled = addBtn.first().is('[disabled]');

    logger.info(`[Target rendered] btnText="${btnText}" disabled=${btnDisabled} oos=${outOfStock}`);

    if (outOfStock) {
      return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
    }
    if (addBtn.length > 0 && !btnDisabled) {
      const isPre = /pre-?order/.test(btnText);
      return { storeSlug: this.storeSlug, status: isPre ? 'PREORDER' : 'IN_STOCK', productUrl };
    }
    if (addBtn.length > 0 && btnDisabled) {
      return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
    }
    return null;
  }
}
