import ZipPriceCheck from '../components/products/ZipPriceCheck';

/**
 * Standalone ZIP price check — works for any supported product URL, including
 * items that aren't tracked yet.
 */
export default function ZipCheckPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="section-title">📍 ZIP Price Check</h1>
        <p className="section-subtitle">
          Same item, same retailer, different store — see where it's cheapest and what's actually on the shelf.
        </p>
      </div>

      <ZipPriceCheck showUrlInput />

      <div className="card p-4 mt-4">
        <p className="text-caption1 text-dark-label2 font-semibold mb-1">Why only these four retailers?</p>
        <p className="text-caption2 text-dark-label3">
          Walmart, Target, Home Depot and Lowe's set prices per store, so a different ZIP can genuinely mean a
          different price. Amazon, eBay and Newegg price nationally — checking multiple ZIPs there would just
          return the same number, so they're not offered here.
        </p>
      </div>
    </div>
  );
}
