import { Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { toCsv } from '../utils/csv';
import { detectStore, extractMetadata, slugify, nameFromUrl } from '../services/importUrl';
import { summarizeRestocks } from '../services/analytics';

const IMPORT_UA =
  process.env.SCRAPER_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Prepend a UTF-8 BOM so Excel reads accents correctly, and set download headers.
function sendCsv(res: Response, filenameBase: string, csv: string): void {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-${date}.csv"`);
  res.send('﻿' + csv);
}

export const getMyTrackings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const trackings = await prisma.tracking.findMany({
      where: { userId: req.user!.id, isActive: true },
      include: {
        product: {
          include: {
            storeListings: {
              include: { store: true },
              orderBy: [{ inStock: 'desc' }, { price: 'asc' }],
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(trackings);
  } catch (error) {
    logger.error('GetMyTrackings error', error);
    res.status(500).json({ error: 'Failed to fetch trackings' });
  }
};

export const addTracking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.body;
    const user = req.user!;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const existing = await prisma.tracking.findUnique({
      where: { userId_productId: { userId: user.id, productId } },
    });

    if (existing) {
      if (!existing.isActive) {
        await prisma.tracking.update({ where: { id: existing.id }, data: { isActive: true } });
        res.json({ message: 'Tracking re-enabled', tracking: existing });
        return;
      }
      res.status(409).json({ error: 'Already tracking this product' });
      return;
    }

    // Check tracking limit
    if (user.trackingLimit !== -1) {
      const count = await prisma.tracking.count({ where: { userId: user.id, isActive: true } });
      if (count >= user.trackingLimit) {
        res.status(403).json({
          error: `Tracking limit reached (${user.trackingLimit} item${user.trackingLimit > 1 ? 's' : ''}). Upgrade your account to track more.`,
          limitReached: true,
          currentCount: count,
          limit: user.trackingLimit,
        });
        return;
      }
    }

    const tracking = await prisma.tracking.create({
      data: { userId: user.id, productId },
      include: { product: { include: { storeListings: { include: { store: true } } } } },
    });

    res.status(201).json({ tracking, message: 'Tracking started' });
  } catch (error) {
    logger.error('AddTracking error', error);
    res.status(500).json({ error: 'Failed to add tracking' });
  }
};

export const removeTracking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    const tracking = await prisma.tracking.findUnique({
      where: { userId_productId: { userId: req.user!.id, productId } },
    });

    if (!tracking) { res.status(404).json({ error: 'Tracking not found' }); return; }

    await prisma.tracking.update({ where: { id: tracking.id }, data: { isActive: false } });
    res.json({ message: 'Tracking removed' });
  } catch (error) {
    logger.error('RemoveTracking error', error);
    res.status(500).json({ error: 'Failed to remove tracking' });
  }
};

// POST /api/tracking/import — paste a product URL: auto-detect the retailer,
// scrape page metadata for name/image, create the product + listing if new, and
// start tracking it. Stock/price fill in on the next scheduled check.
export const importTracking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { url } = req.body;
    const user = req.user!;

    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, domain: true },
    });
    const store = detectStore(url, stores);
    if (!store) {
      res.status(422).json({ error: "We don't support that retailer yet — paste a link from a supported store." });
      return;
    }

    // Reuse an existing listing for this exact URL so we don't duplicate products.
    let listing = await prisma.storeProduct.findFirst({ where: { url }, include: { product: true } });
    let product = listing?.product ?? null;

    if (!product) {
      let meta: { name?: string; image?: string } = {};
      try {
        const resp = await axios.get(url, { timeout: 10000, maxRedirects: 5, headers: { 'User-Agent': IMPORT_UA } });
        meta = extractMetadata(String(resp.data));
      } catch (e: any) {
        logger.info('import: metadata fetch failed, using URL-derived name', { url, error: e.message });
      }

      const name = (meta.name || nameFromUrl(url)).slice(0, 200);
      const base = slugify(name);
      const clash = await prisma.product.findUnique({ where: { slug: base } });
      const slug = clash ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base;

      product = await prisma.product.create({
        data: { name, slug, imageUrl: meta.image ?? null, isNew: true },
      });
      listing = await prisma.storeProduct.create({
        data: { productId: product.id, storeId: store.id, url },
        include: { product: true },
      });
    }

    // Tracking limit + create/reactivate this user's tracking.
    const existing = await prisma.tracking.findUnique({
      where: { userId_productId: { userId: user.id, productId: product.id } },
    });
    if (existing?.isActive) {
      res.status(409).json({ error: 'You are already tracking this product.', product });
      return;
    }
    if (!existing && user.trackingLimit !== -1) {
      const count = await prisma.tracking.count({ where: { userId: user.id, isActive: true } });
      if (count >= user.trackingLimit) {
        res.status(403).json({ error: `Tracking limit reached (${user.trackingLimit}).`, limitReached: true });
        return;
      }
    }

    const tracking = existing
      ? await prisma.tracking.update({ where: { id: existing.id }, data: { isActive: true } })
      : await prisma.tracking.create({ data: { userId: user.id, productId: product.id } });

    res.status(201).json({
      product,
      tracking,
      store: { slug: store.slug, name: store.name },
      message: 'Tracking started — stock and price will update on the next check.',
    });
  } catch (error) {
    logger.error('ImportTracking error', error);
    res.status(500).json({ error: 'Failed to import product' });
  }
};

// PATCH /api/tracking/:productId — per-item notification preferences.
export const updateTracking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    const { notifyEmail, notifyPush, watchStores, autoBuyEnabled, autoBuyMaxPrice, note, tags } = req.body;

    const tracking = await prisma.tracking.findUnique({
      where: { userId_productId: { userId: req.user!.id, productId } },
    });
    if (!tracking) { res.status(404).json({ error: 'Tracking not found' }); return; }

    const data: Record<string, unknown> = {};
    if (notifyEmail !== undefined) data.notifyEmail = !!notifyEmail;
    if (notifyPush !== undefined) data.notifyPush = !!notifyPush;
    if (watchStores !== undefined) data.watchStores = watchStores;
    if (autoBuyEnabled !== undefined) data.autoBuyEnabled = !!autoBuyEnabled;
    if (autoBuyMaxPrice !== undefined) data.autoBuyMaxPrice = autoBuyMaxPrice;
    // Trim/normalize a private note; empty string clears it.
    if (note !== undefined) data.note = typeof note === 'string' && note.trim() ? note.trim() : null;
    // Dedupe, trim, drop empties, cap length.
    if (tags !== undefined) {
      data.tags = Array.isArray(tags)
        ? [...new Set(tags.map((t: unknown) => String(t).trim()).filter(Boolean))].slice(0, 20)
        : [];
    }

    const updated = await prisma.tracking.update({ where: { id: tracking.id }, data });
    res.json(updated);
  } catch (error) {
    logger.error('UpdateTracking error', error);
    res.status(500).json({ error: 'Failed to update tracking' });
  }
};

// GET /api/tracking/export — CSV of the user's tracked items (one row per store listing).
export const exportTrackings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const trackings = await prisma.tracking.findMany({
      where: { userId: req.user!.id, isActive: true },
      include: {
        product: { include: { storeListings: { include: { store: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Flatten to one row per (tracked product × store listing); products with no
    // listings still get a single row so nothing silently disappears.
    type Row = {
      product: string;
      category: string | null;
      store: string;
      status: string;
      inStock: string;
      price: number | null;
      currency: string;
      url: string;
      lastChecked: Date | null;
      trackingSince: Date;
    };
    const rows: Row[] = [];
    for (const t of trackings) {
      const listings = t.product.storeListings;
      if (listings.length === 0) {
        rows.push({
          product: t.product.name, category: t.product.category, store: '', status: '',
          inStock: '', price: null, currency: '', url: '', lastChecked: null, trackingSince: t.createdAt,
        });
        continue;
      }
      for (const l of listings) {
        rows.push({
          product: t.product.name,
          category: t.product.category,
          store: l.store.name,
          status: l.stockStatus ?? '',
          inStock: l.inStock ? 'yes' : 'no',
          price: l.price,
          currency: l.currency,
          url: l.url,
          lastChecked: l.lastChecked,
          trackingSince: t.createdAt,
        });
      }
    }

    const csv = toCsv(rows, [
      { header: 'Product', value: (r) => r.product },
      { header: 'Category', value: (r) => r.category },
      { header: 'Store', value: (r) => r.store },
      { header: 'Status', value: (r) => r.status },
      { header: 'In Stock', value: (r) => r.inStock },
      { header: 'Price', value: (r) => r.price },
      { header: 'Currency', value: (r) => r.currency },
      { header: 'Product URL', value: (r) => r.url },
      { header: 'Last Checked', value: (r) => r.lastChecked?.toISOString() ?? '' },
      { header: 'Tracking Since', value: (r) => r.trackingSince.toISOString() },
    ]);

    sendCsv(res, 'trackit-tracked-items', csv);
  } catch (error) {
    logger.error('ExportTrackings error', error);
    res.status(500).json({ error: 'Failed to export tracked items' });
  }
};

// GET /api/tracking/alerts/export — CSV of the user's alert history.
export const exportAlerts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alerts = await prisma.alert.findMany({
      where: { userId: req.user!.id },
      orderBy: { sentAt: 'desc' },
      take: 5000,
    });

    // Worker-created Alert rows don't set storeProductId, so join product names
    // by productId (the field that IS populated) rather than via the relation.
    const productIds = [...new Set(alerts.map((a) => a.productId).filter((x): x is string => !!x))];
    const products = productIds.length
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    const csv = toCsv(alerts, [
      { header: 'Product', value: (a) => (a.productId ? nameById.get(a.productId) ?? '' : '') },
      { header: 'Store', value: (a) => a.storeName ?? '' },
      { header: 'Type', value: (a) => a.type },
      { header: 'Status', value: (a) => a.status ?? '' },
      { header: 'Price', value: (a) => a.price },
      { header: 'Sent At', value: (a) => a.sentAt.toISOString() },
      { header: 'Email Sent', value: (a) => (a.emailSent ? 'yes' : 'no') },
      { header: 'SMS Sent', value: (a) => (a.smsSent ? 'yes' : 'no') },
      { header: 'Push Sent', value: (a) => (a.pushSent ? 'yes' : 'no') },
      { header: 'Discord Sent', value: (a) => (a.discordSent ? 'yes' : 'no') },
    ]);

    sendCsv(res, 'trackit-alerts', csv);
  } catch (error) {
    logger.error('ExportAlerts error', error);
    res.status(500).json({ error: 'Failed to export alerts' });
  }
};

export const getAlertHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where: { userId: req.user!.id },
        include: {
          storeProduct: {
            include: { product: true, store: true },
          },
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.alert.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({ alerts, total });
  } catch (error) {
    logger.error('GetAlertHistory error', error);
    res.status(500).json({ error: 'Failed to fetch alert history' });
  }
};

// Personal restock analytics: how often the user's tracked items come back in
// stock, when (in their local time), and from which retailers. Sourced from the
// Alert table (type IN_STOCK = a true out→in transition), already per-user.
const ANALYTICS_WINDOW_DAYS = 90;

export const getTrackingAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const since = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 86_400_000);

    const [user, trackedCount, alerts] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
      prisma.tracking.count({ where: { userId, isActive: true } }),
      prisma.alert.findMany({
        where: { userId, type: 'IN_STOCK', sentAt: { gte: since } },
        select: { sentAt: true, storeSlug: true },
        orderBy: { sentAt: 'asc' },
        take: 5000,
      }),
    ]);

    const timezone = user?.timezone || 'UTC';
    const summary = summarizeRestocks(
      alerts.map((a) => ({ createdAt: a.sentAt, storeSlug: a.storeSlug || 'unknown' })),
      timezone
    );

    res.json({ trackedCount, windowDays: ANALYTICS_WINDOW_DAYS, timezone, summary });
  } catch (error) {
    logger.error('GetTrackingAnalytics error', error);
    res.status(500).json({ error: 'Failed to compute analytics' });
  }
};
