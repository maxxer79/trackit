import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

export interface StockResult {
  storeSlug: string;
  status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'LIMITED' | 'PREORDER' | 'UNKNOWN';
  price?: number;
  originalPrice?: number;
  productUrl: string;
  message?: string;
}

export abstract class BaseScraper {
  protected storeSlug: string;
  protected client: AxiosInstance;
  protected userAgent: string;

  constructor(storeSlug: string) {
    this.storeSlug = storeSlug;
    this.userAgent =
      process.env.SCRAPER_USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    this.client = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
      },
    });
  }

  abstract checkStock(productUrl: string, storeProductId?: string): Promise<StockResult>;

  protected async fetchPage(url: string): Promise<string> {
    const response = await this.client.get(url);
    return response.data;
  }

  protected loadHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  protected parsePrice(priceStr: string): number | undefined {
    const match = priceStr.replace(/[^0-9.]/g, '');
    const price = parseFloat(match);
    return isNaN(price) ? undefined : price;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
