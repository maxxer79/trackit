/**
 * Fallback search URL templates keyed by store slug.
 * Used when a store record doesn't have a searchUrl set in the DB.
 * {query} is replaced with the URL-encoded product name.
 */
export const STORE_SEARCH_URLS: Record<string, string> = {
  amazon:         'https://www.amazon.com/s?k={query}',
  bestbuy:        'https://www.bestbuy.com/site/searchpage.jsp?st={query}',
  walmart:        'https://www.walmart.com/search?q={query}',
  target:         'https://www.target.com/s?searchTerm={query}',
  costco:         'https://www.costco.com/CatalogSearch?keyword={query}',
  gamestop:       'https://www.gamestop.com/search/?q={query}',
  newegg:         'https://www.newegg.com/p/pl?d={query}',
  bhphotovideo:   'https://www.bhphotovideo.com/c/search?q={query}',
  adorama:        'https://www.adorama.com/l/?searchinfo={query}',
  microcenter:    'https://www.microcenter.com/search/search_results.aspx?Ntt={query}',
  ebay:           'https://www.ebay.com/sch/i.html?_nkw={query}',
  microsoft:      'https://www.microsoft.com/en-us/search/shop?q={query}',
  nintendo:       'https://www.nintendo.com/us/search/#q={query}',
  apple:          'https://www.apple.com/us/search/{query}',
  dell:           'https://www.dell.com/en-us/search/results.aspx#q={query}',
  lenovo:         'https://www.lenovo.com/us/en/search?q={query}',
  homedepot:      'https://www.homedepot.com/s/{query}',
  lego:           'https://www.lego.com/en-us/search?q={query}',
  staples:        'https://www.staples.com/search?query={query}',
  samsclub:       'https://www.samsclub.com/b/search?searchTerm={query}',
  stockx:         'https://stockx.com/search?s={query}',
  toysrus:        'https://www.toysrus.com/search?q={query}',
  kohls:          'https://www.kohls.com/search.jsp?search={query}',
  officedepot:    'https://www.officedepot.com/catalog/search.do?Ntt={query}',
  meijer:         'https://www.meijer.com/shopping/search-results.html?query={query}',
  walgreens:      'https://www.walgreens.com/search/results.jsp?Ntt={query}',
  cvs:            'https://www.cvs.com/search/{query}',
  bjs:            'https://www.bjs.com/search/{query}',
  antonline:      'https://www.antonline.com/search?q={query}',
  popmart:        'https://www.popmart.com/us/search?keywords={query}',
  playasia:       'https://www.play-asia.com/search/{query}',
};

/** Build a ready-to-open URL from a template and a search term. */
export function buildSearchUrl(template: string, query: string): string {
  return template.replace('{query}', encodeURIComponent(query));
}
