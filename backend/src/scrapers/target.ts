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
          const availability = product?.fulfillment?.shipping_options?.availability_status;
          const price = product?.price?.current_retail;

          let status: StockResult['status'] = 'UNKNOWN';
          if (availability === 'IN_STOCK') status = 'IN_STOCK';
          else if (availability === 'OUT_OF_STOCK') status = 'OUT_OF_STOCK';
          else if (availability === 'PREORDER') status = 'PREORDER';

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
