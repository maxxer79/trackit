import { BaseScraper, StockResult } from './base';
import { fetchRenderedHtml, extractJsonFromRendered, fetchRawJson, fetchJsonWithSolverrCookies } from './browserFetch';
import logger from '../utils/logger';

export class TargetScraper extends BaseScraper {
  constructor() {
    super('target');
  }

  async checkStock(productUrl: string, storeProductId?: string): Promise<StockResult> {
    try {
      // storeProductId is the DB record id (cuid), NOT a TCIN — only use
      // it if it's actually numeric
      const tcin =
        (storeProductId && /^\d{8,9}$/.test(storeProductId) ? storeProductId : undefined) ||
        productUrl.match(/A-(\d+)/)?.[1];

      if (tcin) {
        const apiUrl = this.redskyUrl(tcin);

        // Attempt 1: direct API call (fast when Target accepts it)
        try {
          const response = await this.client.get(apiUrl, {
            headers: {
              Accept: 'application/json',
              Referer: 'https://www.target.com/',
              Origin: 'https://www.target.com',
            },
          });
          const result = this.mapRedsky(tcin, response.data, productUrl);
          if (result) return result;
        } catch (apiErr: any) {
          logger.warn(`[Target] Redsky API failed for TCIN ${tcin}: ${apiErr.message}`);
        }

        // Attempt 2: same API fetched THROUGH the browser (FlareSolverr /
        // Chromium) — Target's page never embeds availability; the data
        // exists ONLY behind this API, which 403s non-browser clients.
        const result = await this.checkRedskyViaBrowser(tcin, productUrl);
        if (result) return result;
      }

      // HTML fallback — check disabled state so pre-order with locked button → OUT_OF_STOCK
      const html = await this.fetchPage(productUrl);

      // Target SSR embeds availability_status (snake_case) in __TGT_DATA__
      // and schema.org JSON-LD availability in the SEO head
      const embedded = this.detectEmbedded(html);
      if (embedded) {
        return { storeSlug: this.storeSlug, status: embedded, productUrl };
      }

      const $ = this.loadHtml(html);

      const outOfStock = $('[data-test="outOfStockMessage"]').length > 0;
      const addToCartBtn = $('button[data-test="addToCartButton"]');
      const btnPresent = addToCartBtn.length > 0;
      const btnDisabled = addToCartBtn.is('[disabled]') || addToCartBtn.attr('disabled') !== undefined;

      logger.info(`[Target HTML] btnPresent=${btnPresent} btnDisabled=${btnDisabled} outOfStock=${outOfStock}`);

      let status: StockResult['status'];
      if (outOfStock) {
        status = 'OUT_OF_STOCK';
      } else if (btnPresent && !btnDisabled) {
        status = 'IN_STOCK';
      } else if (btnPresent && btnDisabled) {
        // Button exists but is disabled → pre-order locked or unavailable
        status = 'OUT_OF_STOCK';
      } else {
        status = 'UNKNOWN';
      }

      if (status !== 'UNKNOWN') {
        return { storeSlug: this.storeSlug, status, productUrl };
      }

      // Target serves a JS shell to plain requests — render the real page
      return await this.checkViaRendered(productUrl);
    } catch (error: any) {
      // Plain fetch failed entirely — try the rendered path before giving up
      try {
        return await this.checkViaRendered(productUrl);
      } catch {
        return {
          storeSlug: this.storeSlug,
          status: 'UNKNOWN',
          productUrl,
          message: error.message,
        };
      }
    }
  }

  private redskyUrl(tcin: string): string {
    // Fulfillment/shipping availability is only included when the request
    // carries store + location context (zip/state/lat/long), like Target's
    // own frontend sends.
    return (
      `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1` +
      `?key=9f36aeafbe60771e321a7cc95a78140772ab3e96` +
      `&tcin=${tcin}` +
      `&store_id=3991&pricing_store_id=3991&has_pricing_store_id=true` +
      `&scheduled_delivery_store_id=3991` +
      `&zip=55403&state=MN&latitude=44.970&longitude=-93.280` +
      `&has_financing_options=true&visitor_id=0100000000000000&channel=WEB` +
      `&page=%2Fp%2FA-${tcin}&is_bot=false`
    );
  }

  /** Map a Redsky pdp_client_v1 response to a stock result (null = no data). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapRedsky(tcin: string, data: any, productUrl: string): StockResult | null {
    const product = data?.data?.product;
    // Fulfillment may live on the product itself, on ANY child (bundles /
    // variation parents carry many), or as available_to_promise_network.
    // Scan all candidates; any sellable one wins (mirrors target.com, which
    // shows the buy button if any variant ships).
    const children: any[] = Array.isArray(product?.children) ? product.children : [];
    const candidates = [product, ...children].filter(Boolean);
    let fulfillment: any;
    let availability: string | undefined;
    for (const c of candidates) {
      const f = c?.fulfillment;
      const a =
        f?.shipping_options?.availability_status ??
        c?.available_to_promise_network?.availability;
      if (!fulfillment && (f || a)) {
        fulfillment = f;
        availability = a;
      }
      // Prefer a sellable candidate over the first one found
      if (a === 'IN_STOCK' || a === 'PRE_ORDER_SELLABLE' || f?.preorder?.is_available_for_preorder === true) {
        fulfillment = f;
        availability = a;
        break;
      }
    }
    const child = children[0];
    const price = product?.price?.current_retail ?? child?.price?.current_retail;

    logger.info(`[Target TCIN:${tcin}] availability=${availability} preorder=${JSON.stringify(fulfillment?.preorder)}`);

    if (!availability && !fulfillment?.preorder) {
      // Log the response shape so detection can be extended without guessing
      logger.info(
        `[Target TCIN:${tcin}] no availability in response; product keys=[${Object.keys(product ?? {}).join(',')}] fulfillment keys=[${Object.keys(fulfillment ?? {}).join(',')}]`
      );
      return null;
    }

    // is_preorder=true + is_available_for_preorder=true  → PREORDER (button clickable)
    // is_preorder=true + is_available_for_preorder=false → OUT_OF_STOCK (button disabled)
    const isPreorder: boolean =
      fulfillment?.preorder?.is_preorder === true || availability === 'PREORDER';
    const preorderAvailable: boolean =
      fulfillment?.preorder?.is_available_for_preorder !== false;

    let status: StockResult['status'];

    if (availability === 'PRE_ORDER_SELLABLE') {
      status = 'PREORDER';
    } else if (availability === 'PRE_ORDER_UNSELLABLE') {
      status = 'OUT_OF_STOCK';
    } else if (isPreorder) {
      status = preorderAvailable ? 'PREORDER' : 'OUT_OF_STOCK';
    } else if (availability === 'IN_STOCK') {
      status = 'IN_STOCK';
    } else if (
      availability === 'OUT_OF_STOCK' ||
      availability === 'UNAVAILABLE' ||
      availability === 'NOT_SOLD_IN_STORE' ||
      availability === 'BACKORDER'
    ) {
      status = 'OUT_OF_STOCK';
    } else {
      return null;
    }

    // In-store pickup signal. store_options only appears in the fulfillment_v1
    // response and reflects Target's DEFAULT fulfillment store (store_id 3991,
    // Minneapolis — see fulfillmentUrl), NOT the user's ZIP. We surface the
    // store's location_name so any pickup alert makes clear WHICH store it is.
    // When store_options is absent (e.g. client_v1) leave pickup undefined
    // (unknown) rather than asserting it's unavailable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeOptions: any[] = Array.isArray(fulfillment?.store_options) ? fulfillment.store_options : [];
    let pickupAvailable: boolean | undefined;
    let pickupLocation: string | undefined;
    if (storeOptions.length > 0) {
      pickupAvailable = false;
      for (const so of storeOptions) {
        const ok =
          so?.order_pickup?.availability_status === 'IN_STOCK' ||
          so?.curbside?.availability_status === 'IN_STOCK' ||
          so?.in_store_only?.availability_status === 'IN_STOCK';
        if (ok) {
          pickupAvailable = true;
          pickupLocation = pickupLocation ?? so?.location_name ?? undefined;
        }
      }
    }

    return {
      storeSlug: this.storeSlug,
      status,
      price: price ? parseFloat(price) : undefined,
      productUrl,
      pickupAvailable,
      pickupLocation,
    };
  }

  private fulfillmentUrl(tcin: string): string {
    // Target split availability out of pdp_client_v1 into a dedicated
    // fulfillment aggregation (confirmed: client_v1 responses carry no
    // fulfillment key at all anymore).
    return (
      `https://redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1` +
      `?key=9f36aeafbe60771e321a7cc95a78140772ab3e96` +
      `&tcin=${tcin}` +
      `&store_id=3991&store_positions_store_id=3991&has_store_positions_store_id=false` +
      `&zip=55403&state=MN&latitude=44.970&longitude=-93.280` +
      `&scheduled_delivery_store_id=3991&required_store_id=3991&has_required_store_id=false&is_bot=false`
    );
  }

  /** Fetch a Redsky API URL through a real browser and parse the JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async fetchJsonViaBrowser(apiUrl: string, label: string): Promise<{ data: any; raw: string } | null> {
    // Preferred: FlareSolverr solves the URL (it reliably gets HTTP 200 where
    // our Chromium gets 403/410), then replay its cookies in a plain GET for
    // the complete raw body - no JSON-viewer virtualization.
    const replayed = await fetchJsonWithSolverrCookies(apiUrl);
    if (replayed) {
      return { data: replayed, raw: JSON.stringify(replayed) };
    }

    // Next: grab the RAW network response via puppeteer. Chrome's JSON
    // viewer virtualizes big documents (fulfillment_v1 is ~250KB), so the
    // rendered-HTML route returns an incomplete body that never parses.
    const rawData = await fetchRawJson(apiUrl);
    if (rawData) {
      return { data: rawData, raw: JSON.stringify(rawData) };
    }

    // Fallback: FlareSolverr rendered page + extraction (works for small
    // responses like client_v1)
    const body = await fetchRenderedHtml(apiUrl);
    if (!body) {
      logger.warn(`[Target] Browser-based ${label} fetch failed`);
      return null;
    }
    const data = extractJsonFromRendered(body);
    if (!data) {
      logger.warn(`[Target] Browser-based ${label} response had no parseable JSON (${body.length} bytes)`);
      return null;
    }
    return { data, raw: body };
  }

  /**
   * Fetch the Redsky APIs through FlareSolverr / Chromium so the requests
   * come from a real browser context: pdp_client_v1 first (price + some
   * shapes), then pdp_fulfillment_v1 (where availability actually lives).
   */
  private async checkRedskyViaBrowser(tcin: string, productUrl: string): Promise<StockResult | null> {
    const client = await this.fetchJsonViaBrowser(this.redskyUrl(tcin), 'client_v1');
    if (client) {
      logger.info(`[Target] Browser-based Redsky fetch SUCCEEDED for TCIN ${tcin}`);
      const mapped = this.mapRedsky(tcin, client.data, productUrl);
      if (mapped) return mapped;
      const embedded = this.detectEmbedded(client.raw);
      if (embedded) {
        logger.info(`[Target TCIN:${tcin}] availability found via raw-JSON regex: ${embedded}`);
        return { storeSlug: this.storeSlug, status: embedded, productUrl };
      }
    }

    // client_v1 had no fulfillment — query the dedicated fulfillment API
    const ff = await this.fetchJsonViaBrowser(this.fulfillmentUrl(tcin), 'fulfillment_v1');
    if (ff) {
      logger.info(`[Target] Browser-based fulfillment_v1 fetch SUCCEEDED for TCIN ${tcin}`);
      const mapped = this.mapRedsky(tcin, ff.data, productUrl);
      if (mapped) {
        // Carry price over from client_v1 if fulfillment lacks it
        if (mapped.price === undefined && client) {
          const p = client.data?.data?.product?.price?.current_retail;
          if (p) mapped.price = parseFloat(p);
        }
        return mapped;
      }
      const embedded = this.detectEmbedded(ff.raw);
      if (embedded) {
        logger.info(`[Target TCIN:${tcin}] availability found via fulfillment raw-JSON regex: ${embedded}`);
        return { storeSlug: this.storeSlug, status: embedded, productUrl };
      }
    }
    return null;
  }

  /**
   * Availability from Target-specific embedded data: __TGT_DATA__
   * availability_status values AND the schema.org JSON-LD that Target
   * server-renders in the page head for SEO (present even in the JS shell).
   */
  private detectEmbedded(html: string): StockResult['status'] | null {
    if (/"availability_status"\s*:\s*"PRE_ORDER_SELLABLE"/i.test(html)) return 'PREORDER';
    if (/"availability_status"\s*:\s*"PRE_ORDER_UNSELLABLE"/i.test(html)) return 'OUT_OF_STOCK';
    if (/"availability_status"\s*:\s*"IN_STOCK"/i.test(html)) return 'IN_STOCK';
    if (/"availability_status"\s*:\s*"OUT_OF_STOCK"/i.test(html)) return 'OUT_OF_STOCK';
    // schema.org JSON-LD in the SEO head
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?PreOrder"/i.test(html)) return 'PREORDER';
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?InStock"/i.test(html)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"(https?:\/\/schema\.org\/)?OutOfStock"/i.test(html)) return 'OUT_OF_STOCK';
    return null;
  }

  /**
   * FlareSolverr / headless Chromium fallback — renders the real PDP and
   * reads Target-specific signals ONLY (generic text matching on Target's
   * shell caused false out-of-stock readings).
   */
  private async checkViaRendered(productUrl: string): Promise<StockResult> {
    const TARGET_BTN_SELECTOR =
      'button[data-test="addToCartButton"], button[data-test="shippingButton"], [data-test="outOfStockMessage"]';

    // Attempt 1: FlareSolverr (fast, but snapshots before Target's buy
    // button renders about half the time)
    const html = await fetchRenderedHtml(productUrl);
    if (html) {
      const result = this.analyzeRendered(html, productUrl);
      if (result) return result;
    }

    // Attempt 2: local stealth Chromium, explicitly WAITING for Target's
    // buy button / OOS message to render before taking the snapshot
    logger.info('[Target rendered] FlareSolverr snapshot had no signals — retrying with waitSelector');
    const html2 = await fetchRenderedHtml(productUrl, 40000, {
      skipFlareSolverr: true,
      waitSelector: TARGET_BTN_SELECTOR,
    });
    if (html2) {
      const result = this.analyzeRendered(html2, productUrl);
      if (result) return result;
      // Diagnostics: log what availability-ish strings the page DID contain
      const hints = Array.from(new Set([
        ...(html2.match(/"availability[_a-zA-Z]*"\s*:\s*"[A-Za-z_]+"/g) ?? []),
        ...(html2.match(/schema\.org\/[A-Za-z]+/g) ?? []),
      ])).slice(0, 15);
      logger.info(`[Target rendered] still no signals after waitSelector; hints: ${hints.join(' | ') || 'NONE'}`);
    }

    return { storeSlug: this.storeSlug, status: 'UNKNOWN', productUrl, message: 'Rendered page had no recognizable Target signals' };
  }

  /** Returns a result when the page carries definitive signals, else null. */
  private analyzeRendered(html: string, productUrl: string): StockResult | null {
    const embedded = this.detectEmbedded(html);
    if (embedded) {
      return { storeSlug: this.storeSlug, status: embedded, productUrl };
    }

    const $ = this.loadHtml(html);
    const outOfStock = $('[data-test="outOfStockMessage"]').length > 0;
    const addBtn = $('button[data-test="addToCartButton"], button[data-test="shippingButton"]');
    const btnText = addBtn.first().text().trim().toLowerCase();
    const btnDisabled = addBtn.first().is('[disabled]');

    logger.info(`[Target rendered] btnText="${btnText}" disabled=${btnDisabled} oos=${outOfStock}`);

    if (outOfStock) {
      return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
    }
    if (addBtn.length > 0 && !btnDisabled) {
      const isPre = /pre-?order/.test(btnText);
      return { storeSlug: this.storeSlug, status: isPre ? 'PREORDER' : 'IN_STOCK', productUrl };
    }
    if (addBtn.length > 0 && btnDisabled) {
      return { storeSlug: this.storeSlug, status: 'OUT_OF_STOCK', productUrl };
    }
    return null;
  }
}
