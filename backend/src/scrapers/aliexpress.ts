/**
 * AliExpress scraper. AliExpress pages never go network-idle (constant
 * background polling), so the generic browser render hangs until the per-store
 * cap (~100s). Here we render with `domcontentloaded` + a short timeout so it
 * resolves fast, then read AliExpress's embedded quantity/price data. Falls back
 * to the generic DOM/JSON detection. Best-effort: AliExpress aggressively
 * bot-walls datacenter IPs, so an UNKNOWN result (which never flips stock) is a
 * normal outcome — the important fix is that it no longer hangs.
 */
import { GenericScraper } from './generic';
import { StockResult } from './base';
import { fetchRenderedHtml } from './browserFetch';

type Status = StockResult['status'];

export class AliExpressScraper extends GenericScraper {
  async checkStock(productUrl: string): Promise<StockResult> {
    // Fast render: DOM-ready is enough for the embedded JSON; skip FlareSolverr
    // (AliExpress isn't Cloudflare) and keep the timeout well under the cap.
    const html = await fetchRenderedHtml(productUrl, 30000, {
      waitUntil: 'domcontentloaded',
      skipFlareSolverr: true,
    });

    if (!html) {
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'AliExpress did not render (likely bot-blocked)' };
    }
    if (this.isBotBlocked(html)) {
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'AliExpress bot-blocked' };
    }

    // AliExpress-specific quantity signal first.
    const ali = this.detectAli(html, productUrl);
    if (ali.status !== 'UNKNOWN') return ali;

    // Fall back to the generic detector (JSON-LD / embedded state / DOM).
    const generic = this.detect(html, productUrl);
    if (generic.status === 'UNKNOWN' && !generic.message) {
      generic.message = 'AliExpress rendered but no stock signal recognized';
    }
    if (generic.price == null) generic.price = this.extractAliPrice(html);
    return generic;
  }

  private detectAli(html: string, productUrl: string): StockResult {
    let status: Status = 'UNKNOWN';

    // Embedded inventory fields used across AliExpress page variants.
    const qtyMatch =
      html.match(/"totalAvailQuantity"\s*:\s*(\d+)/) ||
      html.match(/"availQuantity"\s*:\s*(\d+)/) ||
      html.match(/"totalQuantity"\s*:\s*(\d+)/) ||
      html.match(/"inventory"\s*:\s*"?(\d+)"?/);
    if (qtyMatch) {
      status = parseInt(qtyMatch[1], 10) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
    }

    return {
      storeSlug: this.storeSlug,
      status,
      price: this.extractAliPrice(html),
      productUrl,
      message: status !== 'UNKNOWN' ? 'via AliExpress inventory field' : undefined,
    };
  }

  private extractAliPrice(html: string): number | undefined {
    const m =
      html.match(/"formatedActivityPrice"\s*:\s*"[^"\d]*([\d,]+\.?\d*)"/) ||
      html.match(/"minActivAmount"\s*:\s*\{[^}]*?"value"\s*:\s*([\d.]+)/) ||
      html.match(/"actMinPrice"\s*:\s*\{[^}]*?"value"\s*:\s*([\d.]+)/) ||
      html.match(/<meta[^>]+property="og:price:amount"[^>]+content="([\d.]+)"/i);
    if (m) {
      const p = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isNaN(p) && p > 0) return p;
    }
    return this.extractPriceFromJson(html);
  }
}
