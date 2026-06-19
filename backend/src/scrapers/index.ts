import { BaseScraper } from './base';
import { AmazonScraper } from './amazon';
import { AppleScraper } from './apple';
import { HomeDepotScraper } from './homedepot';
import { LowesScraper } from './lowes';
import { BestBuyScraper } from './bestbuy';
import { WalmartScraper } from './walmart';
import { TargetScraper } from './target';
import { NeweggScraper } from './newegg';
import { GameStopScraper } from './gamestop';
import { EbayScraper } from './ebay';
import { GenericScraper } from './generic';
import { HasbroPulseScraper } from './hasbropulse';
import { AliExpressScraper } from './aliexpress';

const scraperRegistry: Map<string, BaseScraper> = new Map();

/**
 * Wraps a dedicated scraper with the GenericScraper as fallback.
 * If the dedicated scraper can't determine status (API 403/504, bot-block,
 * markup change), the generic scraper retries — including its FlareSolverr /
 * headless-browser fallback. Fast API path when it works, browser path
 * when it doesn't.
 */
class WithGenericFallback extends BaseScraper {
  private primary: BaseScraper;
  private generic: GenericScraper;

  constructor(slug: string, primary: BaseScraper) {
    super(slug);
    this.primary = primary;
    this.generic = new GenericScraper(slug);
  }

  async checkStock(url: string, storeProductId?: string) {
    const r = await this.primary.checkStock(url, storeProductId);
    if (r.status !== 'UNKNOWN') return r;
    const g = await this.generic.checkStock(url);
    if (g.status !== 'UNKNOWN') return g;
    // Both unknown — keep the more informative message
    return { ...g, message: g.message ?? r.message };
  }
}

// Register dedicated scrapers (all but eBay get the generic/browser fallback;
// eBay has its own Puppeteer fallback and its URLs are search pages, which
// the generic product-page detection doesn't understand)
scraperRegistry.set('amazon', new WithGenericFallback('amazon', new AmazonScraper()));
scraperRegistry.set('bestbuy', new WithGenericFallback('bestbuy', new BestBuyScraper()));
scraperRegistry.set('walmart', new WithGenericFallback('walmart', new WalmartScraper()));
// Target has its own complete pipeline (API → HTML → rendered) — the generic
// fallback misread stray JSON in Target's page shell as out-of-stock
scraperRegistry.set('target', new TargetScraper());
scraperRegistry.set('newegg', new WithGenericFallback('newegg', new NeweggScraper()));
scraperRegistry.set('gamestop', new WithGenericFallback('gamestop', new GameStopScraper()));
scraperRegistry.set('ebay', new EbayScraper());
scraperRegistry.set('hasbropulse', new WithGenericFallback('hasbropulse', new HasbroPulseScraper()));
scraperRegistry.set('apple', new WithGenericFallback('apple', new AppleScraper()));
scraperRegistry.set('homedepot', new WithGenericFallback('homedepot', new HomeDepotScraper()));
scraperRegistry.set('lowes', new WithGenericFallback('lowes', new LowesScraper()));
// AliExpress has its own fast-render path (no generic fallback — the generic
// browser render is exactly what hangs on AliExpress).
scraperRegistry.set('aliexpress', new AliExpressScraper('aliexpress'));

// All other stores use the generic scraper
const allStores = [
  'amd', 'asus', 'adorama', 'antonline', 'bhphotovideo', 'bjs',
  'bandainamco', 'canon', 'costco', 'dell', 'disney',
  'fujifilm', 'gamefly', 'gigabyte', 'govee', 'hallmark', 'homedepot',
  'kohls', 'kroger', 'lg', 'lego', 'lenovo', 'mattel', 'meijer',
  'microcenter', 'microsoft', 'msi', 'ninjakitchen', 'nintendo',
  'nvidia', 'oculus', 'officedepot', 'playasia', 'playstation',
  'pokemoncenter', 'popmart', 'qvc', 'samsclub', 'stockx', 'toysrus',
  'verizon', 'zotac', 'apple', 'nike', 'footlocker', 'hasbro', 'sony',
  'google', 'samsung', 'bambulabs', 'ubiquiti', 'lowes', 'valve',
];

for (const store of allStores) {
  if (!scraperRegistry.has(store)) {
    scraperRegistry.set(store, new GenericScraper(store));
  }
}

// Domain → dedicated scraper routing. Protects against store records whose
// slug doesn't exactly match the registry name (a mismatched slug silently
// routed Lowe's to the generic scraper).
const domainMap: Record<string, string> = {
  'aliexpress.com': 'aliexpress',
  'aliexpress.us': 'aliexpress',
  'amazon.com': 'amazon',
  'apple.com': 'apple',
  'bestbuy.com': 'bestbuy',
  'ebay.com': 'ebay',
  'gamestop.com': 'gamestop',
  'hasbropulse.com': 'hasbropulse',
  'homedepot.com': 'homedepot',
  'lowes.com': 'lowes',
  'newegg.com': 'newegg',
  'target.com': 'target',
  'walmart.com': 'walmart',
};

export function getScraperForStore(storeSlug: string, productUrl?: string): BaseScraper {
  // 1. Exact slug
  const direct = scraperRegistry.get(storeSlug);
  if (direct) return direct;

  // 2. Normalized slug ("Lowes.com" / "lowes-com" / "LOWES" → "lowes")
  const normalized = storeSlug.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/com$/, '');
  const byNormalized = scraperRegistry.get(normalized);
  if (byNormalized) return byNormalized;

  // 3. URL domain
  if (productUrl) {
    try {
      const host = new URL(productUrl).hostname.replace(/^www\./, '');
      for (const [domain, slug] of Object.entries(domainMap)) {
        if (host === domain || host.endsWith(`.${domain}`)) {
          const byDomain = scraperRegistry.get(slug);
          if (byDomain) return byDomain;
        }
      }
    } catch {}
  }

  return new GenericScraper(storeSlug);
}

export { scraperRegistry };
