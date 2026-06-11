import { BaseScraper, StockResult } from './base';
import axios from 'axios';

export class BestBuyScraper extends BaseScraper {
  constructor() {
    super('bestbuy');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    // Best Buy has a public availability API — try it first, but it
    // frequently 504s/blocks server requests, so always fall back to HTML.
    const skuMatch =
      storeProductId ||
      productUrl.match(/\/(\d{7,8})\.p/)?.[1] ||
      productUrl.match(/[?&]skuId=(\d+)/)?.[1];

    if (skuMatch) {
      try {
        const apiResult = await this.checkViaApi(skuMatch, productUrl);
        if (apiResult.status !== 'UNKNOWN') return apiResult;
      } catch {
        // API failed (504, blocked) — fall through to HTML
      }
    }

    try {
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

    if (this.isBotBlocked(html)) {
      return {
        storeSlug: this.storeSlug,
        status: 'UNKNOWN',
        productUrl,
        message: 'Best Buy served a bot-challenge page',
      };
    }

    // Best Buy SSR embeds availability in hydration JSON — most reliable
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?InStock"/i.test(html) ||
        /"buttonState"\s*:\s*"ADD_TO_CART"/i.test(html)) {
      const priceMatch = html.match(/"customerPrice"\s*:\s*([\d.]+)/i) ?? html.match(/"currentPrice"\s*:\s*([\d.]+)/i);
      return {
        storeSlug: this.storeSlug,
        status: 'IN_STOCK',
        price: priceMatch ? parseFloat(priceMatch[1]) : undefined,
        productUrl,
      };
    }
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?OutOfStock"/i.test(html) ||
        /"buttonState"\s*:\s*"SOLD_OUT"/i.test(html)) {
      return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
    }
    if (/"buttonState"\s*:\s*"PRE_ORDER"/i.test(html)) {
      return { storeSlug: this.storeSlug, status: 'PREORDER', productUrl };
    }

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
