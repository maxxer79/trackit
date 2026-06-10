import { BaseScraper, StockResult } from './base';

export class GameStopScraper extends BaseScraper {
  constructor() {
    super('gamestop');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      const html = await this.fetchPage(productUrl);

      if (this.isBotBlocked(html)) {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: 'GameStop served a bot-challenge page',
        };
      }

      // GameStop uses Next.js SSR — availability lives in __NEXT_DATA__
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextMatch) {
        try {
          const nextData = JSON.parse(nextMatch[1]);
          const pageProps = nextData?.props?.pageProps ?? {};
          const product = pageProps?.productData?.product ?? pageProps?.product ?? pageProps?.initialData?.product;
          if (product) {
            const isAvailable = product?.availability?.isAvailable ?? product?.isAvailable ?? product?.inStock;
            const price = parseFloat(product?.price?.salePrice ?? product?.price ?? '');
            if (isAvailable === true) {
              return { storeSlug: this.storeSlug, status: 'IN_STOCK', price: isNaN(price) ? undefined : price, productUrl };
            }
            if (isAvailable === false) {
              return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
            }
          }
        } catch {}
      }

      // JSON-LD fallback
      if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?InStock"/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'IN_STOCK', productUrl };
      }
      if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?OutOfStock"/i.test(html)) {
        return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
      }

      const $ = this.loadHtml(html);

      const addToCart = $('button[data-testid="addToCartButton"]').length > 0 ||
                        $('button:contains("Add to Cart")').length > 0;
      const notAvailable = $('button:contains("Notify Me")').length > 0 ||
                           $('.not-available').length > 0;
      const priceText = $('[data-testid="price"]').text() || $('[class*="ProductPrice"]').text();

      return {
        storeSlug: this.storeSlug,
        status: addToCart ? 'IN_STOCK' : notAvailable ? 'OUT_OF_STOCK' : 'UNKNOWN',
        price: priceText ? this.parsePrice(priceText) : undefined,
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
