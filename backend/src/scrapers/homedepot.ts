/**
 * Home Depot scraper.
 *
 * The HTML pages are behind Akamai (hard block). But Home Depot's GraphQL
 * gateway lives on a SEPARATE host — apionline.homedepot.com — which used to
 * accept cookie-less POSTs. HD now sometimes rejects those with a
 * "Generic Errors API" response, so on failure we mint an Akamai-validated
 * session via FlareSolverr (solve www.homedepot.com) and retry the POST with
 * those cookies.
 *
 * Item id (OMSID) comes from the product URL: /p/{name}/{itemId}
 */
import axios from 'axios';
import { BaseScraper, StockResult } from './base';
import { getSolverrSession, SolverrSession } from './browserFetch';
import logger from '../utils/logger';

const GQL = 'https://apionline.homedepot.com/federation-gateway/graphql';

// Default store — Home Depot requires a storeId for fulfillment.
// 277 = Miami (Calle Ocho), taken from the owner's real browser session;
// online (ship-to-home) availability is national regardless of store.
const DEFAULT_STORE = process.env.HOMEDEPOT_STORE_ID || '277';
const DEFAULT_ZIP = process.env.HOMEDEPOT_ZIP || '33135';

const FULFILLMENT_QUERY = `query productFulfillment($itemId: String!, $storeId: String, $zipCode: String) {
  product(itemId: $itemId, dataSource: "fulfillment") {
    itemId
    availabilityType { type discontinued __typename }
    fulfillment(storeId: $storeId, zipCode: $zipCode) {
      backordered
      fulfillmentOptions {
        type
        fulfillable
        services {
          type
          deliveryTimeline
          locations { inventory { isInStock isLimitedQuantity quantity __typename } __typename }
          __typename
        }
        __typename
      }
      __typename
    }
    pricing(storeId: $storeId) { value __typename }
    __typename
  }
}`;

export class HomeDepotScraper extends BaseScraper {
  constructor() {
    super('homedepot');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    const itemId =
      (storeProductId && /^\d{6,12}$/.test(storeProductId) ? storeProductId : undefined) ||
      productUrl.match(/\/p\/(?:[^/]+\/)*(\d{6,12})(?:[/?#]|$)/)?.[1];

    if (!itemId) {
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'No Home Depot item id in URL' };
    }

    // Attempt 1: cookie-less POST (worked 2026-06-11)
    let result = await this.queryFulfillment(itemId, productUrl);
    if (result) return result;

    // Attempt 2: replay an Akamai-validated session from FlareSolverr
    const session = await getSolverrSession('https://www.homedepot.com/');
    if (session) {
      logger.info(`[HomeDepot ${itemId}] retrying GraphQL with FlareSolverr session cookies`);
      result = await this.queryFulfillment(itemId, productUrl, session);
      if (result) return result;
    }

    return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'Home Depot GraphQL unavailable' };
  }

  private async queryFulfillment(
    itemId: string,
    productUrl: string,
    session?: SolverrSession
  ): Promise<StockResult | null> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://www.homedepot.com',
        Referer: 'https://www.homedepot.com/',
        'User-Agent':
          session?.userAgent ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        // Custom headers from a real browser session (captured 2026-06-11)
        'x-experience-name': 'fusion-gm-pip-desktop',
        'x-hd-dc': 'origin',
        'x-debug': 'false',
        'x-current-url': new URL(productUrl).pathname,
        'Sec-Ch-Ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
      };
      if (session) headers.Cookie = session.cookieHeader;

      const { data } = await axios.post(
        `${GQL}?opname=productFulfillment`,
        {
          operationName: 'productFulfillment',
          variables: { itemId, storeId: DEFAULT_STORE, zipCode: DEFAULT_ZIP },
          query: FULFILLMENT_QUERY,
        },
        { timeout: 15000, headers }
      );

      // GraphQL errors come back as HTTP 200 with an errors array —
      // surface the first one so logs reveal schema mismatches precisely
      if (Array.isArray(data?.errors) && data.errors.length > 0) {
        logger.warn(`[HomeDepot ${itemId}] GraphQL errors: ${data.errors[0]?.message ?? 'unknown'}`);
      }

      const product = data?.data?.product;
      if (!product) {
        const sample = JSON.stringify(data ?? null).slice(0, 300);
        logger.warn(
          `[HomeDepot ${itemId}] GraphQL returned no product node${session ? ' (with session cookies)' : ''}; response sample=${sample}`
        );
        return null;
      }

      const discontinued = product?.availabilityType?.discontinued === true;
      const price = product?.pricing?.value;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any[] = product?.fulfillment?.fulfillmentOptions ?? [];

      // In stock if ANY fulfillment option (ship-to-home or pickup) is
      // fulfillable with positive inventory. Separately track whether the
      // PICKUP option specifically is available, plus its store location, for
      // in-store pickup alerts.
      let inStock = false;
      let limited = false;
      let pickupAvailable = false;
      let pickupLocation: string | undefined;
      for (const opt of options) {
        // HD fulfillment option types: "pickup" (BOPIS) vs "delivery"/"ship".
        const isPickup = String(opt?.type ?? '').toLowerCase().includes('pickup');
        if (opt?.fulfillable) {
          for (const svc of opt?.services ?? []) {
            for (const loc of svc?.locations ?? []) {
              const inv = loc?.inventory;
              if (inv?.isInStock === true || (typeof inv?.quantity === 'number' && inv.quantity > 0)) {
                inStock = true;
                if (inv?.isLimitedQuantity) limited = true;
                if (isPickup) {
                  pickupAvailable = true;
                  pickupLocation = pickupLocation ?? loc?.storeName ?? loc?.locationName ?? undefined;
                }
              }
            }
          }
        }
      }

      logger.info(`[HomeDepot ${itemId}] discontinued=${discontinued} inStock=${inStock} limited=${limited} options=${options.length}`);

      let status: StockResult['status'];
      if (inStock) status = limited ? 'LIMITED' : 'IN_STOCK';
      else if (discontinued || options.length > 0) status = 'OUT_OF_STOCK';
      else status = 'UNKNOWN';

      return {
        storeSlug: this.storeSlug,
        status,
        price: typeof price === 'number' ? price : undefined,
        productUrl,
        // Only assert pickup state when we actually parsed fulfillment options;
        // an empty/failed response leaves it undefined (unknown), never false.
        pickupAvailable: options.length > 0 ? pickupAvailable : undefined,
        pickupLocation,
      };
    } catch (err: any) {
      const code = err?.response?.status;
      logger.warn(`[HomeDepot ${itemId}] GraphQL failed (${code ?? err.message})${session ? ' (with session cookies)' : ''}`);
      return null;
    }
  }
}
