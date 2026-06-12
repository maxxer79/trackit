/**
 * Home Depot scraper.
 *
 * The HTML pages are behind Akamai (hard block). But Home Depot's GraphQL
 * gateway lives on a SEPARATE host — apionline.homedepot.com — which accepts
 * POST queries with just a couple of custom headers (no cookie/auth needed).
 * We query the fulfillment model for the item's availability.
 *
 * Item id (OMSID) comes from the product URL: /p/{name}/{itemId}
 */
import axios from 'axios';
import { BaseScraper, StockResult } from './base';
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

    try {
      const { data } = await axios.post(
        `${GQL}?opname=productFulfillment`,
        {
          operationName: 'productFulfillment',
          variables: { itemId, storeId: DEFAULT_STORE, zipCode: DEFAULT_ZIP },
          query: FULFILLMENT_QUERY,
        },
        {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            Origin: 'https://www.homedepot.com',
            Referer: 'https://www.homedepot.com/',
            'User-Agent':
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
          },
        }
      );

      // GraphQL errors come back as HTTP 200 with an errors array —
      // surface the first one so logs reveal schema mismatches precisely
      if (Array.isArray(data?.errors) && data.errors.length > 0) {
        logger.warn(`[HomeDepot ${itemId}] GraphQL errors: ${data.errors[0]?.message ?? 'unknown'}`);
      }

      const product = data?.data?.product;
      if (!product) {
        const sample = JSON.stringify(data ?? null).slice(0, 300);
        logger.warn(`[HomeDepot ${itemId}] GraphQL returned no product node; response sample=${sample}`);
        return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'No product in GraphQL response' };
      }

      const discontinued = product?.availabilityType?.discontinued === true;
      const price = product?.pricing?.value;
      const options: any[] = product?.fulfillment?.fulfillmentOptions ?? [];

      // In stock if ANY fulfillment option (ship-to-home or pickup) is
      // fulfillable with positive inventory
      let inStock = false;
      let limited = false;
      for (const opt of options) {
        if (opt?.fulfillable) {
          for (const svc of opt?.services ?? []) {
            for (const loc of svc?.locations ?? []) {
              const inv = loc?.inventory;
              if (inv?.isInStock === true || (typeof inv?.quantity === 'number' && inv.quantity > 0)) {
                inStock = true;
                if (inv?.isLimitedQuantity) limited = true;
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
      };
    } catch (err: any) {
      const code = err?.response?.status;
      logger.warn(`[HomeDepot ${itemId}] GraphQL failed (${code ?? err.message})`);
      return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: `GraphQL error ${code ?? err.message}` };
    }
  }
}
