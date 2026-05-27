import { BaseScraper, StockResult } from './base';
import axios from 'axios';

export class BestBuyScraper extends BaseScraper {
  constructor() {
    super('bestbuy');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      // Best Buy has a public availability API
      const skuMatch = storeProductId || productUrl.match(/\/(\d{7})\.p/)?.[1];
      if (skuMatch) {
        return await this.checkViaApi(skuMatch, productUrl);
      }
      return await this.checkViaHtml(productUrl);
    } catch (error: any) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: error.message,
      };
    }
  }

  private async checkViaApi(sku: string, productUrl: string): Promise<StockResult> {
    const apiUrl = `https://www.bestbuy.com/api/3.0/priceBlocks?skus=${sku}`;
    const response = await axios.get(apiUrl, {
      headers: { 'User-Agent': this.userAgent },
    });

    const data = response.data?.[0];
    if (!data) {
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl };
    }

    const availability = data.sku?.buttonState?.buttonState;
    const price = data.sku?.currentPrice?.currentPrice;

    let status: StockResult['status'] = 'OUT_OF_STOCK';
    if (availability === 'ADD_TO_CART' || availability === 'COMING_SOON_BUT_AVAILABLE') {
      status = 'IN_STOCK';
    } else if (availability === 'PRE_ORDER') {
      status = 'PREORDER';
    }

    return {
      storeSlug: this.storeSlug,
      status,
      price: price ? parseFloat(price) : undefined,
      productUrl,
    };
  }

  private async checkViaHtml(productUrl: string): Promise<StockResult> {
    const html = await this.fetchPage(productUrl);
    const $ = this.loadHtml(html);

    const addToCartBtn = $('[data-button-state="ADD_TO_CART"]').length > 0;
    const soldOut = $('[data-button-state="SOLD_OUT"]').length > 0;
    const priceText = $('[data-testid="customer-price"] span').first().text();

    let status: StockResult['status'] = 'UNKNOWN';
    if (addToCartBtn) status = 'IN_STOCK';
    else if (soldOut) status = 'OUT_OF_STOCK';

    return {
      storeSlug: this.storeSlug,
      status,
      price: priceText ? this.parsePrice(priceText) : undefined,
      productUrl,
    };
  }
}
