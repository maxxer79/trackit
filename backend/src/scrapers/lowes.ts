/**
 * Lowe's scraper.
 *
 * Product data comes from the "wpd" (web product detail) JSON endpoint,
 * captured from a real browser session (2026-06-11):
 *   https://www.lowes.com/wpd/{productId}/productdetail/{storeId}/Guest/{zip}
 *
 * The endpoint lives on www.lowes.com (Akamai-guarded), so:
 *   1. try a direct GET with browser-like headers
 *   2. fall back to fetching it through FlareSolverr / Chromium
 *
 * Product id comes from the page URL: /pd/{name}/{productId}
 */
import axios from 'axios';
import { BaseScraper, StockResult } from './base';
import { fetchRenderedHtml, extractJsonFromRendered } from './browserFetch';
import logger from '../utils/logger';

const STORE = process.env.LOWES_STORE_ID || '0592';
const ZIP = process.env.LOWES_ZIP || '33909';
const ZIP_STATE = process.env.LOWES_STATE || 'FL';

type Signal = { key: string; value: string | number | boolean; path: string };

export class LowesScraper extends BaseScraper {
  constructor() {
    super('lowes');
  }

  private wpdUrl(productId: string): string {
    return (
      `https://www.lowes.com/wpd/${productId}/productdetail/${STORE}/Guest/${ZIP}` +
      `?nearByStore=${STORE}&zipState=${ZIP_STATE}`
    );
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    const productId =
      (storeProductId && /^\d{8,12}$/.test(storeProductId) ? storeProductId : undefined) ||
      productUrl.match(/\/pd\/(?:[^/]+\/)*(\d{8,12})(?:[/?#]|$)/)?.[1];

    if (!productId) {
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'No Lowe\'s product id in URL (expected /pd/{name}/{id})' };
    }

    const apiUrl = this.wpdUrl(productId);

    // Attempt 1: direct GET
    try {
      const { data } = await axios.get(apiUrl, {
        timeout: 15000,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: `https://www.lowes.com/pd/x/${productId}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
          'Sec-Ch-Ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
      });
      const result = this.mapWpd(productId, data, productUrl);
      if (result) return result;
    } catch (err: any) {
      logger.warn(`[Lowes ${productId}] direct wpd failed: ${err?.response?.status ?? err.message}`);
    }

    // Attempt 2: through FlareSolverr / Chromium (worked for Target's API)
    const body = await fetchRenderedHtml(apiUrl);
    if (body) {
      const data = extractJsonFromRendered(body);
      if (data) {
        logger.info(`[Lowes ${productId}] browser-based wpd fetch SUCCEEDED`);
        const result = this.mapWpd(productId, data, productUrl);
        if (result) return result;
      } else {
        logger.warn(`[Lowes ${productId}] browser-based wpd response had no parseable JSON (${body.length} bytes)`);
      }
    }

    return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'Lowe\'s wpd data unavailable' };
  }

  /**
   * Walk the wpd JSON collecting availability/price signals, log them
   * (so the first real run reveals Lowe's exact field names), and map
   * the strongest signal to a status.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapWpd(productId: string, data: any, productUrl: string): StockResult | null {
    const signals: Signal[] = [];
    const prices: number[] = [];
    // Pickup-specific signals: the wpd endpoint is already store-scoped (storeId
    // + zip), so a pickup/bopis-keyed availability flag means "available for
    // in-store pickup at THIS store". Kept separate from the general availability
    // signals so a ship-to-home flag never masquerades as pickup.
    const pickupSignals: Signal[] = [];
    let storeName: string | undefined;
    const seen = new Set<any>();

    const walk = (node: any, path: string, depth: number) => {
      if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
      seen.add(node);
      for (const [key, value] of Object.entries(node)) {
        const t = typeof value;
        if (t === 'object') {
          walk(value, `${path}.${key}`, depth + 1);
        } else if (t === 'boolean' || t === 'string' || t === 'number') {
          if (/availab|in.?stock|purchasable|stock.?status|sellable|buyable|backorder/i.test(key)) {
            signals.push({ key, value: value as any, path: `${path}.${key}` });
          }
          // Pickup signal only when the KEY itself names pickup/BOPIS — avoids
          // generic "available" (ship-to-home) being read as pickup.
          if (/pickup|bopis|bopus/i.test(key) && (t === 'boolean' || t === 'string' || (t === 'number' && /qty|quantity|count|stock/i.test(key)))) {
            pickupSignals.push({ key, value: value as any, path: `${path}.${key}` });
          }
          if (t === 'string' && !storeName && /store.?name|store.?label|storedisplayname/i.test(key) && value) {
            storeName = String(value);
          }
          if (t === 'number' && /sellingprice|finalprice|itemprice|^price$|minprice/i.test(key) && (value as number) > 0) {
            prices.push(value as number);
          }
        }
      }
    };
    walk(data, '$', 0);

    if (signals.length === 0) {
      logger.info(`[Lowes ${productId}] no availability signals in wpd response; top-level keys=[${Object.keys(data ?? {}).join(',')}]`);
      return null;
    }
    logger.info(
      `[Lowes ${productId}] signals: ${signals.slice(0, 10).map((s) => `${s.path}=${s.value}`).join(' | ')}`
    );

    // Decide: any positive boolean or "available"-ish string wins; explicit
    // negatives count only if no positive exists.
    let positive = false;
    let negative = false;
    for (const s of signals) {
      const v = s.value;
      if (typeof v === 'boolean') {
        if (/not|un/i.test(s.key) ? !v : v) positive = true;
        else negative = true;
      } else if (typeof v === 'string') {
        if (/^(available|in.?stock|instock)$/i.test(v)) positive = true;
        else if (/out.?of.?stock|unavailable|oos|sold.?out|discontinued/i.test(v)) negative = true;
      } else if (typeof v === 'number') {
        if (/quantity|qty|stocklevel/i.test(s.key)) {
          if (v > 0) positive = true;
          else negative = true;
        }
      }
    }

    const price = prices.length ? Math.min(...prices) : undefined;

    // In-store pickup: stays undefined (unknown) unless the response carried a
    // clearly pickup-keyed signal — never assert false, so we never fire a wrong
    // pickup alert. Location uses the store name when present, else the store #.
    let pickupAvailable: boolean | undefined;
    if (pickupSignals.length > 0) {
      logger.info(
        `[Lowes ${productId}] pickup signals: ${pickupSignals.slice(0, 8).map((s) => `${s.path}=${s.value}`).join(' | ')}`
      );
      let pPos = false;
      let pNeg = false;
      for (const s of pickupSignals) {
        const v = s.value;
        if (typeof v === 'boolean') {
          if (/not|un/i.test(s.key) ? !v : v) pPos = true;
          else pNeg = true;
        } else if (typeof v === 'string') {
          if (/^(available|in.?stock|instock|true|yes)$/i.test(v)) pPos = true;
          else if (/^(out.?of.?stock|unavailable|oos|sold.?out|false|no)$/i.test(v)) pNeg = true;
        } else if (typeof v === 'number') {
          if (v > 0) pPos = true;
          else pNeg = true;
        }
      }
      if (pPos) pickupAvailable = true;
      else if (pNeg) pickupAvailable = false;
    }
    const pickupLocation = pickupAvailable === true ? (storeName ?? `Lowe's #${STORE}`) : undefined;

    if (positive) {
      return { storeSlug: this.storeSlug, status: 'IN_STOCK', price, productUrl, pickupAvailable, pickupLocation };
    }
    if (negative) {
      return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', price, productUrl, pickupAvailable, pickupLocation };
    }
    return null;
  }
}
