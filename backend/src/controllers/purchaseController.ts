import { Response } from 'express';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { carrierTrackingUrl, mapShip24Milestone, ship24CourierCode } from '../services/carriers';
import { ship24Enabled, createTracker, getTrackerResults } from '../services/ship24';

// Attach a carrier deep-link and coerce Decimal price → number for the client.
function shape(p: any) {
  return {
    ...p,
    price: p.price != null ? Number(p.price) : null,
    trackingUrl: carrierTrackingUrl(p.carrier, p.trackingNumber),
    liveTrackingEnabled: ship24Enabled(),
  };
}

// Pull the latest Ship24 status into a purchase row. Creates a tracker on first
// use (consumes quota), then records the milestone and maps it to our status.
// Reused by the manual refresh endpoint and the scheduled poller.
export async function syncPurchaseDelivery(purchase: any): Promise<any> {
  if (!ship24Enabled() || !purchase.trackingNumber) return purchase;

  let trackerId: string | null = purchase.ship24TrackerId;
  if (!trackerId) {
    trackerId = await createTracker(purchase.trackingNumber, ship24CourierCode(purchase.carrier));
    if (!trackerId) return purchase;
  }

  const { milestone } = await getTrackerResults(trackerId);
  const data: Record<string, unknown> = {
    ship24TrackerId: trackerId,
    deliveryMilestone: milestone,
    deliveryUpdatedAt: new Date(),
  };
  const mapped = mapShip24Milestone(milestone);
  // Don't override a user-set CANCELLED; don't downgrade a delivered item.
  if (mapped && purchase.status !== 'CANCELLED' && purchase.status !== 'DELIVERED') {
    data.status = mapped;
    if (mapped === 'DELIVERED' && !purchase.deliveredAt) data.deliveredAt = new Date();
  }
  return prisma.purchase.update({ where: { id: purchase.id }, data });
}

export const getMyPurchases = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const purchases = await prisma.purchase.findMany({
      where: { userId: req.user!.id },
      orderBy: { purchasedAt: 'desc' },
    });
    res.json(purchases.map(shape));
  } catch (error) {
    logger.error('GetMyPurchases error', error);
    res.status(500).json({ error: 'Failed to fetch purchases' });
  }
};

export const createPurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, storeName, storeSlug, price, carrier, trackingNumber, status, note, purchasedAt } = req.body;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, slug: true },
    });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const purchase = await prisma.purchase.create({
      data: {
        userId: req.user!.id,
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        storeName: storeName ?? null,
        storeSlug: storeSlug ?? null,
        price: price ?? null,
        carrier: carrier ?? null,
        trackingNumber: trackingNumber?.trim() || null,
        status: status ?? 'ORDERED',
        note: note?.trim() || null,
        purchasedAt: purchasedAt ? new Date(purchasedAt) : new Date(),
      },
    });
    res.status(201).json(shape(purchase));
  } catch (error) {
    logger.error('CreatePurchase error', error);
    res.status(500).json({ error: 'Failed to record purchase' });
  }
};

export const updatePurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.purchase.findFirst({ where: { id, userId: req.user!.id } });
    if (!existing) { res.status(404).json({ error: 'Purchase not found' }); return; }

    const { storeName, price, carrier, trackingNumber, status, note, deliveredAt } = req.body;
    const data: Record<string, unknown> = {};
    if (storeName !== undefined) data.storeName = storeName || null;
    if (price !== undefined) data.price = price;
    if (carrier !== undefined) data.carrier = carrier || null;
    if (trackingNumber !== undefined) data.trackingNumber = typeof trackingNumber === 'string' && trackingNumber.trim() ? trackingNumber.trim() : null;
    if (note !== undefined) data.note = typeof note === 'string' && note.trim() ? note.trim() : null;
    if (deliveredAt !== undefined) data.deliveredAt = deliveredAt ? new Date(deliveredAt) : null;
    if (status !== undefined) {
      data.status = status;
      // Stamp a delivery date automatically when marked delivered (unless given).
      if (status === 'DELIVERED' && deliveredAt === undefined && !existing.deliveredAt) {
        data.deliveredAt = new Date();
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const updated = await prisma.purchase.update({ where: { id }, data });
    res.json(shape(updated));
  } catch (error) {
    logger.error('UpdatePurchase error', error);
    res.status(500).json({ error: 'Failed to update purchase' });
  }
};

export const refreshPurchaseTracking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!ship24Enabled()) {
      res.status(503).json({ error: 'Live tracking is not configured on this server' });
      return;
    }
    const { id } = req.params;
    const purchase = await prisma.purchase.findFirst({ where: { id, userId: req.user!.id } });
    if (!purchase) { res.status(404).json({ error: 'Purchase not found' }); return; }
    if (!purchase.trackingNumber) { res.status(400).json({ error: 'Add a tracking number first' }); return; }

    const updated = await syncPurchaseDelivery(purchase);
    res.json(shape(updated));
  } catch (error) {
    logger.error('RefreshPurchaseTracking error', error);
    res.status(502).json({ error: 'Could not reach the tracking provider' });
  }
};

export const deletePurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await prisma.purchase.deleteMany({ where: { id, userId: req.user!.id } });
    if (result.count === 0) { res.status(404).json({ error: 'Purchase not found' }); return; }
    res.json({ message: 'Purchase deleted' });
  } catch (error) {
    logger.error('DeletePurchase error', error);
    res.status(500).json({ error: 'Failed to delete purchase' });
  }
};
