import { Request, Response, NextFunction } from 'express';
import { runZipCheck, UnsupportedRetailerError, MAX_ZIPS_PER_CHECK } from '../services/zipCheck';
import { ZIP_CHECK_STORES } from '../services/storeLocator';

/**
 * POST /api/zip-check
 *
 * Body: { productUrl, zips[], storeProductId?, force? }
 *
 * Always returns one row per valid ZIP. Rows with locationResolved:false could
 * not be mapped to a store and carry NO price — the UI must render them as
 * "couldn't check", never as that ZIP's price.
 */
export async function postZipCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { productUrl, zips, storeProductId, force } = req.body as {
      productUrl: string;
      zips: string[];
      storeProductId?: string;
      force?: boolean;
    };

    const { storeSlug, results } = await runZipCheck({ productUrl, zips, storeProductId, force });

    const priced = results.filter((r) => r.locationResolved && typeof r.price === 'number');
    const cheapest = priced.length
      ? priced.reduce((lo, r) => (r.price! < lo.price! ? r : lo)).zip
      : null;

    res.json({
      storeSlug,
      productUrl,
      results,
      // Convenience for the UI's highlight; null when nothing was priceable.
      cheapestZip: cheapest,
      unresolvedCount: results.filter((r) => !r.locationResolved).length,
    });
  } catch (err) {
    if (err instanceof UnsupportedRetailerError) {
      res.status(400).json({ error: err.message, supportedStores: ZIP_CHECK_STORES });
      return;
    }
    next(err);
  }
}

/** GET /api/zip-check/stores — which retailers support per-ZIP checks. */
export function getZipCheckStores(_req: Request, res: Response): void {
  res.json({ stores: ZIP_CHECK_STORES, maxZips: MAX_ZIPS_PER_CHECK });
}
