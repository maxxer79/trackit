import cron from 'node-cron';
import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { prisma } from '../config/database';
import { sendNotificationToUser } from './notificationService';
import logger from '../utils/logger';
import { getScraperForStore } from '../scrapers/index';

// ── Browser search fallback ───────────────────────────────────────────────────
// Used for retailers that block direct HTTP requests (GameStop, ABT, etc.)
// Launches Chromium, searches the store for the product name, and checks
// if the first matching result is available to buy.

let browserBusy = false;

const BROWSER_SEARCH_URLS: Record<string, string> = {
  gamestop: 'https://www.gamestop.com/search/?q={query}',
  abt:      'https://www.abt.com/search/?q={query}',
};

async function checkViaSearch(
  storeSlug: string,
  productName: string
): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  if (browserBusy) {
    logger.info(`Browser busy — skipping search check for ${storeSlug}`);
    return 'UNKNOWN';
  }
  const template = BROWSER_SEARCH_URLS[storeSlug];
  if (!template) return 'UNKNOWN';

  const searchUrl = template.replace('{query}', encodeURIComponent(productName));
  browserBusy = true;
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Manual stealth: override webdriver flag that sites detect
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    logger.info(`Browser search: ${storeSlug} → "${productName}"`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for JS to render product cards
    await new Promise<void>(r => setTimeout(r, 3000));

    // Evaluate runs in browser context — DOM globals available via tsconfig DOM lib
    const status = await page.evaluate((name: string) => {
      const nameWords = name.toLowerCase().split(' ').filter(w => w.length > 3);

      const cardSelectors = [
        '[class*="product-item"]', '[class*="ProductCard"]', '[class*="product-card"]',
        'li[class*="product"]',    '[data-testid*="product"]', '[class*="search-result"]',
      ];
      for (const sel of cardSelectors) {
        for (const card of Array.from(document.querySelectorAll(sel))) {
          const cardText = (card.textContent || '').toLowerCase();
          const matches = nameWords.filter(w => cardText.includes(w)).length;
          if (matches >= Math.min(2, nameWords.length)) {
            const html = (card as Element).innerHTML.toLowerCase();
            if (/add[\s-]to[\s-]cart/i.test(html)) return 'IN_STOCK';
            if (/notify[\s-]me|sold[\s-]out|not[\s-]available/i.test(html)) return 'OUT_OF_STOCK';
          }
        }
      }

      const body = document.body.innerText.toLowerCase();
      const hasAdd    = /add to cart/i.test(body);
      const hasNotify = /notify me when available/i.test(body);
      const hasSold   = /sold out/i.test(body);
      if (hasAdd && !hasNotify && !hasSold) return 'IN_STOCK';
      if ((hasNotify || hasSold) && !hasAdd) return 'OUT_OF_STOCK';
      return 'UNKNOWN';
    }, productName) as 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';

    logger.info(`Browser search result: ${storeSlug} "${productName}" → ${status}`);
    return status;

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Browser search failed for ${storeSlug}: ${msg}`);
    return 'UNKNOWN';
  } finally {
    browserBusy = false;
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

// ── Retailer-specific checkers ──────────────────────────────────────────────

async function checkBestBuy(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    // SKU appears in multiple URL formats Best Buy uses:
    //   /site/name/6601524.p          (standard)
    //   ?skuId=6601524                 (query param)
    //   /product/name/ID/sku/6601524   (ad/affiliate URLs)
    const skuMatch = url.match(/\/(\d{7,8})\.p/)
      ?? url.match(/[?&]skuId=(\d+)/)
      ?? url.match(/\/sku\/(\d{5,8})(?:[/?#]|$)/);
    if (skuMatch) {
      const sku = skuMatch[1];
      try {
        const { data } = await axios.get(
          `https://www.bestbuy.com/api/3.0/priceBlocks?skus=${sku}`,
          { timeout: 10000, headers: { 'User-Agent': randomUA(), 'Referer': 'https://www.bestbuy.com' } }
        );
        const block = Array.isArray(data) ? data[0] : data;
        const buttonState =
          block?.sku?.buttonState?.buttonState ??
          block?.priceBlock?.priceDomain?.buttonState?.buttonState ?? '';
        if (['ADD_TO_CART', 'PRE_ORDER', 'COMING_SOON_BUT_AVAILABLE'].includes(buttonState)) return 'IN_STOCK';
        if (['SOLD_OUT', 'COMING_SOON', 'NOT_AVAILABLE'].includes(buttonState)) return 'OUT_OF_STOCK';
        // API responded but button state unknown — try HTML fallback
      } catch {
        // API failed — try HTML fallback before giving up
      }
      // HTML fallback: Best Buy does embed JSON-LD and buttonState in their SSR output
      try {
        const { data: html } = await axios.get(url, {
          timeout: 12000,
          headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://www.bestbuy.com' },
        });
        if (/"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(html)) return 'IN_STOCK';
        if (/"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i.test(html)) return 'OUT_OF_STOCK';
        if (/"buttonState"\s*:\s*"ADD_TO_CART"/i.test(html)) return 'IN_STOCK';
        if (/"buttonState"\s*:\s*"SOLD_OUT"/i.test(html)) return 'OUT_OF_STOCK';
      } catch {}
      return 'UNKNOWN';
    }
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkWalmart(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    if (/\"availabilityStatus\"\s*:\s*\"IN_STOCK\"/i.test(data)) return 'IN_STOCK';
    if (/\"availabilityStatus\"\s*:\s*\"OUT_OF_STOCK\"/i.test(data)) return 'OUT_OF_STOCK';
    if (/add to cart/i.test(data)) return 'IN_STOCK';
    if (/out of stock/i.test(data) || /sold out/i.test(data)) return 'OUT_OF_STOCK';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkTarget(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    // Try Target's internal store API
    const tcinMatch = url.match(/A-(\d+)/);
    if (tcinMatch) {
      const tcin = tcinMatch[1];
      const { data } = await axios.get(
        `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?tcin=${tcin}&store_id=911&zip=10001&state=NY&latitude=40.711&longitude=-74.006&country=USA&channel=WEB&page=/p/${tcin}`,
        { timeout: 10000, headers: { 'User-Agent': randomUA() } }
      );
      const avail = data?.data?.product?.available_to_promise_network?.availability;
      if (avail === 'IN_STOCK' || avail === 'LIMITED_STOCK') return 'IN_STOCK';
      if (avail === 'OUT_OF_STOCK') return 'OUT_OF_STOCK';
    }
    return await checkGeneric(url);
  } catch {
    return await checkGeneric(url);
  }
}

async function checkNintendo(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9' },
    });
    // Nintendo embeds availability in JSON-LD or window data
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"availability"\s*:\s*"InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/add to cart/i.test(data) || /"purchasable"\s*:\s*true/i.test(data)) return 'IN_STOCK';
    if (/out of stock/i.test(data) || /sold out/i.test(data)) return 'OUT_OF_STOCK';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkNewegg(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': randomUA() },
    });
    if (/\"inStock\"\s*:\s*true/i.test(data) || /Add to Cart<\/button>/i.test(data)) return 'IN_STOCK';
    if (/\"inStock\"\s*:\s*false/i.test(data) || /Out of Stock/i.test(data)) return 'OUT_OF_STOCK';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkGameStop(url: string, productName?: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9' },
    });
    // Empty response = bot-blocked — fall back to browser search
    if (!data || data.length < 500) {
      return productName ? checkViaSearch('gamestop', productName) : 'UNKNOWN';
    }
    // GameStop uses Next.js SSR — product data lives in __NEXT_DATA__
    const nextMatch = data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nextData = JSON.parse(nextMatch[1]);
        // Traverse common paths where GameStop stores availability
        const pageProps = nextData?.props?.pageProps ?? {};
        const product = pageProps?.productData?.product ?? pageProps?.product ?? pageProps?.initialData?.product;
        if (product) {
          const isAvailable = product?.availability?.isAvailable ?? product?.isAvailable ?? product?.inStock;
          if (isAvailable === true) return 'IN_STOCK';
          if (isAvailable === false) return 'OUT_OF_STOCK';
        }
      } catch {}
    }
    // JSON-LD fallback
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"availability"\s*:\s*"InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    // GameStop-specific button signals (requires no "notify me" to avoid false positives)
    const hasAddToCart = /add to cart/i.test(data);
    const hasNotifyMe = /notify me when available/i.test(data) || /notify me/i.test(data);
    const hasSoldOut  = /sold out/i.test(data);
    if (hasAddToCart && !hasNotifyMe && !hasSoldOut) return 'IN_STOCK';
    if (hasNotifyMe || hasSoldOut) return 'OUT_OF_STOCK';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkAbt(url: string, productName?: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9' },
    });
    // Empty response = bot-blocked — fall back to browser search
    if (!data || data.length < 500) {
      return productName ? checkViaSearch('abt', productName) : 'UNKNOWN';
    }
    // ABT does SSR with JSON-LD structured data — most reliable signal
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"availability"\s*:\s*"InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"inStock"\s*:\s*true/i.test(data)) return 'IN_STOCK';
    if (/"inStock"\s*:\s*false/i.test(data)) return 'OUT_OF_STOCK';
    // ABT-specific button signals
    const hasAddToCart = /id="addToCartBtn"/i.test(data) || /add to cart/i.test(data);
    const hasNotifyMe  = /notify me/i.test(data) || /email me when available/i.test(data);
    const hasOOS       = /out of stock/i.test(data) || /sold out/i.test(data);
    if (hasAddToCart && !hasNotifyMe && !hasOOS) return 'IN_STOCK';
    if (hasNotifyMe || (hasOOS && !hasAddToCart)) return 'OUT_OF_STOCK';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkPlayStationDirect(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9' },
    });

    // PlayStation Direct embeds CTA status in SSR JSON (most reliable)
    // These ctaStatus values drive which button is displayed
    if (/"ctaStatus"\s*:\s*"ADD_TO_CART"/i.test(data))          return 'IN_STOCK';
    if (/"ctaStatus"\s*:\s*"SIGN_IN_TO_BUY"/i.test(data))       return 'IN_STOCK';
    if (/"ctaStatus"\s*:\s*"LOW_STOCK"/i.test(data))            return 'IN_STOCK';
    if (/"ctaStatus"\s*:\s*"CURRENTLY_UNAVAILABLE"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"ctaStatus"\s*:\s*"SOLD_OUT"/i.test(data))             return 'OUT_OF_STOCK';

    // JSON-LD structured data
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"inStock"\s*:\s*true/i.test(data))    return 'IN_STOCK';
    if (/"inStock"\s*:\s*false/i.test(data))   return 'OUT_OF_STOCK';
    if (/"purchasable"\s*:\s*true/i.test(data)) return 'IN_STOCK';
    if (/"purchasable"\s*:\s*false/i.test(data)) return 'OUT_OF_STOCK';

    // PS Direct uses "Currently Unavailable" (not "out of stock") as their OOS label
    // "Sign In to Buy" means the product IS buyable but requires a PSN account
    const hasSignInToBuy     = /sign in to buy/i.test(data);
    const hasCurrentlyUnavail = /currently unavailable/i.test(data);
    const hasLowStock        = /low stock/i.test(data);
    const hasAddToCart       = /add to cart/i.test(data);

    // "Low stock" or "Add to Cart" without "Currently Unavailable" = in stock
    if ((hasLowStock || hasAddToCart) && !hasCurrentlyUnavail) return 'IN_STOCK';
    // "Currently Unavailable" without any buy signal = out of stock
    if (hasCurrentlyUnavail && !hasSignInToBuy && !hasAddToCart) return 'OUT_OF_STOCK';
    // "Sign In to Buy" = available but requires PSN login
    if (hasSignInToBuy && !hasCurrentlyUnavail) return 'IN_STOCK';

    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkStockX(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    // StockX's internal API is blocked from server IPs.
    // Their HTML shell DOES load, and "Make Offer" / "Buy Now" appear in the
    // static markup when active seller listings exist — use that as the signal.
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9' },
    });

    // "Make Offer" in static HTML = buy widget is present = active listings exist
    if (/make offer/i.test(data) || /buy now/i.test(data)) return 'IN_STOCK';

    // StockX doesn't show "out of stock" for marketplace items —
    // if the page loads but has no buy widget it's genuinely delisted
    if (data && data.length > 500) return 'UNKNOWN'; // page loaded but no buy signal
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkDell(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9' },
    });
    // Dell embeds structured data in the initial HTML — target that only
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"availability"\s*:\s*"InStock"/i.test(data)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"OutOfStock"/i.test(data)) return 'OUT_OF_STOCK';
    if (/"inStock"\s*:\s*true/i.test(data) || /"purchasable"\s*:\s*true/i.test(data)) return 'IN_STOCK';
    if (/"inStock"\s*:\s*false/i.test(data) || /"purchasable"\s*:\s*false/i.test(data)) return 'OUT_OF_STOCK';
    // Dell pages are JS-rendered; plain HTTP fetch won't get real stock data
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

async function checkEbayViaPuppeteer(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  if (browserBusy) {
    logger.info('[eBay] Browser busy — skipping Puppeteer fallback');
    return 'UNKNOWN';
  }

  // Ensure LH_BIN=1 (Buy It Now filter)
  let searchUrl = url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('LH_BIN')) parsed.searchParams.set('LH_BIN', '1');
    searchUrl = parsed.toString();
  } catch {}

  browserBusy = true;
  let browser: Browser | undefined;

  try {
    // Use puppeteer-extra + stealth to bypass eBay's headless browser detection
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteerExtra = require('puppeteer-extra');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());

    browser = await puppeteerExtra.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
        '--disable-gpu', '--window-size=1280,800',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    logger.info(`[eBay] Puppeteer (stealth) fetching: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise<void>(r => setTimeout(r, 3000));

    // Log page title for debugging bot-detection vs real page
    const title = await page.title();
    logger.info(`[eBay] Page title: ${title}`);

    const result = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.s-item'));
      const realItems = items.filter(el => {
        const title = el.querySelector('.s-item__title');
        const text = title?.textContent?.trim() ?? '';
        return text.length > 0 && text !== 'Shop on eBay';
      });
      // Also try alternate selectors in case eBay changed class names
      const altItems = document.querySelectorAll('[data-viewport]').length;
      return { count: realItems.length, altCount: altItems, bodySnippet: document.body.innerText.slice(0, 200) };
    });

    logger.info(`[eBay] Puppeteer found ${result.count} listing(s) (alt: ${result.altCount})`);
    logger.info(`[eBay] Body snippet: ${result.bodySnippet.replace(/\n/g, ' ')}`);
    return result.count > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
  } catch (err: any) {
    logger.warn(`[eBay] Puppeteer fallback failed: ${err.message}`);
    return 'UNKNOWN';
  } finally {
    browserBusy = false;
    if (browser) await browser.close().catch(() => {});
  }
}

async function checkEbay(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  // Try EbayScraper first (RSS → HTML, fast, no browser overhead)
  try {
    const scraper = getScraperForStore('ebay');
    const result = await scraper.checkStock(url);
    if (result.status === 'IN_STOCK') return 'IN_STOCK';
    if (result.status === 'OUT_OF_STOCK') return 'OUT_OF_STOCK';
  } catch (err: any) {
    logger.warn(`[eBay] Scraper failed: ${err.message}`);
  }
  // Fall back to Puppeteer (real browser, bypasses eBay bot detection)
  logger.info('[eBay] Falling back to Puppeteer');
  return checkEbayViaPuppeteer(url);
}

async function checkGeneric(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const response = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'max-age=0',
      },
      maxRedirects: 5,
    });

    const html: string = response.data;

    // JSON-LD schema (most reliable)
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
    for (const block of jsonLdMatches) {
      if (/InStock/i.test(block)) return 'IN_STOCK';
      if (/OutOfStock/i.test(block)) return 'OUT_OF_STOCK';
    }

    // Common JS data patterns
    if (/"availability"\s*:\s*"InStock"/i.test(html)) return 'IN_STOCK';
    if (/"availability"\s*:\s*"OutOfStock"/i.test(html)) return 'OUT_OF_STOCK';
    if (/"inStock"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"inStock"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';
    if (/"purchasable"\s*:\s*true/i.test(html)) return 'IN_STOCK';
    if (/"purchasable"\s*:\s*false/i.test(html)) return 'OUT_OF_STOCK';

    // Collect body text signals — check both before deciding
    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    const hasAddToCart = /add to cart/i.test(bodyText) || /add to bag/i.test(bodyText);
    const hasBuyNow   = /buy now/i.test(bodyText);
    const hasInStock  = /\bin stock\b/i.test(bodyText);

    const hasOutOfStock   = /out of stock/i.test(bodyText);
    const hasSoldOut      = /sold out/i.test(bodyText);
    const hasUnavailable  = /currently unavailable/i.test(bodyText) || /temporarily out of stock/i.test(bodyText);
    const hasNotifyMe     = /notify me when available/i.test(bodyText);

    const inStockSignal  = hasAddToCart || hasBuyNow;
    const outStockSignal = hasOutOfStock || hasSoldOut || hasUnavailable || hasNotifyMe;

    // Add-to-cart is a strong DOM signal — if present, trust it over text mentions
    if (inStockSignal && !outStockSignal) return 'IN_STOCK';
    if (outStockSignal && !inStockSignal) return 'OUT_OF_STOCK';
    if (hasInStock && !outStockSignal) return 'IN_STOCK';
    // Conflicting signals (bot page, JS shell, mixed content) → preserve existing DB value
    return 'UNKNOWN';
  } catch (err: any) {
    logger.warn(`checkGeneric failed for ${url}: ${err.message}`);
    return 'UNKNOWN';
  }
}

async function checkUrl(url: string, storeSlug?: string, productName?: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  const domain = getDomain(url);

  if (domain.includes('bestbuy.com'))           return checkBestBuy(url);
  if (domain.includes('walmart.com'))           return checkWalmart(url);
  if (domain.includes('target.com'))            return checkTarget(url);
  if (domain.includes('nintendo.com'))          return checkNintendo(url);
  if (domain.includes('newegg.com'))            return checkNewegg(url);
  if (domain.includes('dell.com'))              return checkDell(url);
  if (domain.includes('gamestop.com'))          return checkGameStop(url, productName);
  if (domain.includes('abt.com'))               return checkAbt(url, productName);
  if (domain.includes('direct.playstation.com') || domain.includes('playstation.com')) return checkPlayStationDirect(url);
  if (domain.includes('stockx.com'))            return checkStockX(url);
  if (domain.includes('ebay.com'))              return checkEbay(url);

  return checkGeneric(url);
}

export async function fetchProductImage(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': randomUA() },
      maxRedirects: 5,
    });
    const $ = cheerio.load(response.data);

    const ogImage = $('meta[property="og:image"]').attr('content') ||
                    $('meta[name="twitter:image"]').attr('content') ||
                    $('meta[property="twitter:image"]').attr('content');
    if (ogImage) return ogImage;

    const selectors = [
      '#landingImage', '#imgBlkFront',    // Amazon
      '.primary-image img',
      '#main-product-image img',
      '.product-image img',
      'img[itemprop="image"]',
      '.product__image img',
      '[data-testid="primary-image"] img',
    ];

    for (const sel of selectors) {
      const src = $(sel).first().attr('src') || $(sel).first().attr('data-src');
      if (src && src.startsWith('http')) return src;
    }

    return null;
  } catch {
    return null;
  }
}

export const checkStockForProduct = async (storeProductId: string): Promise<void> => {
  try {
    const sp = await prisma.storeProduct.findUnique({
      where: { id: storeProductId },
      include: { product: true, store: true },
    });
    if (!sp || !sp.url) return;

    const wasInStock = sp.inStock;
    const status = await checkUrl(sp.url, sp.store.slug, sp.product.name);

    logger.info(`Stock check ${sp.store.name} / ${sp.product.name}: ${status}`);

    if (status === 'UNKNOWN') {
      // Update lastChecked but don't change stock status
      await prisma.storeProduct.update({
        where: { id: storeProductId },
        data: { lastChecked: new Date(), checkCount: { increment: 1 } },
      });
      return;
    }

    const nowInStock = status === 'IN_STOCK';

    await prisma.storeProduct.update({
      where: { id: storeProductId },
      data: { inStock: nowInStock, lastChecked: new Date(), checkCount: { increment: 1 } },
    });

    if (wasInStock !== nowInStock) {
      await (prisma as any).stockEvent.create({
        data: {
          productId: sp.productId,
          storeProductId: sp.id,
          storeName: sp.store.name,
          storeSlug: sp.store.slug,
          productName: sp.product.name,
          status: nowInStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
          price: sp.price ?? null,
          productUrl: sp.url,
        },
      });
    }

    if (!wasInStock && nowInStock) {
      const trackings = await prisma.tracking.findMany({
        where: { productId: sp.productId, isActive: true },
        include: { user: true },
      });
      for (const tracking of trackings) {
        await sendNotificationToUser({
          userId: tracking.userId,
          title: `${sp.product.name} is now IN STOCK!`,
          body: `Available at ${sp.store.name}${sp.price ? ` for $${sp.price}` : ''}. Tap to buy now!`,
          url: sp.url,
          imageUrl: sp.product.imageUrl || undefined,
          storeProductId: sp.id,
          type: 'IN_STOCK',
        });
      }
      logger.info(`Stock alert sent for ${sp.product.name} at ${sp.store.name}`);
    }
  } catch (error) {
    logger.error(`Stock check error for ${storeProductId}`, error);
  }
};

export const runStockCheck = async (): Promise<void> => {
  try {
    const storeProducts = await prisma.storeProduct.findMany({
      where: { product: { isActive: true }, store: { isActive: true }, isActive: true },
      select: { id: true },
    });

    logger.info(`Running stock check for ${storeProducts.length} listings`);

    for (let i = 0; i < storeProducts.length; i += 5) {
      const batch = storeProducts.slice(i, i + 5);
      await Promise.allSettled(batch.map(sp => checkStockForProduct(sp.id)));
      if (i + 5 < storeProducts.length) await new Promise(r => setTimeout(r, 2000));
    }
    logger.info('Stock check complete');
  } catch (error) {
    logger.error('Run stock check error', error);
  }
};

export const startStockChecker = (): void => {
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Stock checker triggered');
    await runStockCheck();
  });
  setTimeout(runStockCheck, 30000);
  logger.info('Stock checker started (every 15 minutes)');
};
