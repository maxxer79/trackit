import { BaseScraper, StockResult } from './base';

export class TargetScraper extends BaseScraper {
  constructor() {
    super('target');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      const tcin = storeProductId || productUrl.match(/A-(\d+)/)?.[1];

      if (tcin) {
        // Target Redsky API
        const apiUrl = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?tcin=${tcin}&is_bot=false`;
        try {
          const response = await this.client.get(apiUrl);
          const product = response.data?.data?.product;
          const fulfillment = product?.fulfillment;
          const availability = fulfillment?.shipping_options?.availability_status;
          const price = product?.price?.current_retail;

          // DEBUG: log raw fulfillment so we can see what Target actually returns
          console.log('[Target] fulfillment:', JSON.stringify(fulfillment, null, 2));

          // Check preorder state — if it's a preorder product, availability_status
          // can incorrectly read IN_STOCK even when the button is disabled.
          // is_available_for_preorder = true  → PREORDER (button works)
          // is_available_for_preorder = false → OUT_OF_STOCK (button disabled)
          const isPreorder: boolean =
            fulfillment?.preorder?.is_preorder === true ||
            availability === 'PREORDER';
          const preorderAvailable: boolean =
            fulfillment?.preorder?.is_available_for_preorder !== false;

          let status: StockResult['status'];

          if (isPreorder) {
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
        } catch {
          // Fall through to HTML
        }
      }

      const html = await this.fetchPage(productUrl);
      const $ = this.loadHtml(html);

      const addToCart = $('button[data-test="addToCartButton"]').length > 0;
      const outOfStock = $('[data-test="outOfStockMessage"]').length > 0;

      return {
        storeSlug: this.storeSlug,
        status: addToCart ? 'IN_STOCK' : outOfStock ? 'OUT_OF_STOCK' : 'UNKNOWN',
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
