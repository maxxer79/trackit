import { BaseScraper, StockResult } from './base';
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
      if (/"availability_status"\s*:\s*"PRE_ORDER_SELLABLE"/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'PREORDER', productUrl };
      }
      if (/"availability_status"\s*:\s*"PRE_ORDER_UNSELLABLE"/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
      }
      if (/"availability_status"\s*:\s*"IN_STOCK"/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'IN_STOCK', productUrl };
      }
      if (/"availability_status"\s*:\s*"OUT_OF_STOCK"/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
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

      return {
        storeSlug: this.storeSlug,
        status,
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
