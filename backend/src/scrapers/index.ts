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
// eBay has its own rendered fallback and its URLs are search pages, which
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

export function getScraperForStore(storeSlug: string): BaseScraper {
  return scraperRegistry.get(storeSlug) || new GenericScraper(storeSlug);
}

export { scraperRegistry };
