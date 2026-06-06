import { BaseScraper } from './base';
import { AmazonScraper } from './amazon';
import { BestBuyScraper } from './bestbuy';
import { WalmartScraper } from './walmart';
import { TargetScraper } from './target';
import { NeweggScraper } from './newegg';
import { GameStopScraper } from './gamestop';
import { EbayScraper } from './ebay';
import { GenericScraper } from './generic';

const scraperRegistry: Map<string, BaseScraper> = new Map();

// Register dedicated scrapers
scraperRegistry.set('amazon', new AmazonScraper());
scraperRegistry.set('bestbuy', new BestBuyScraper());
scraperRegistry.set('walmart', new WalmartScraper());
scraperRegistry.set('target', new TargetScraper());
scraperRegistry.set('newegg', new NeweggScraper());
scraperRegistry.set('gamestop', new GameStopScraper());
scraperRegistry.set('ebay', new EbayScraper());

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
