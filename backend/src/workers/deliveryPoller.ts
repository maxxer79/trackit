import cron from 'node-cron';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { ship24Enabled } from '../services/ship24';
import { syncPurchaseDelivery } from '../controllers/purchaseController';

// Poll EXISTING Ship24 trackers (no tracker creation here, so no quota spend)
// for purchases that aren't in a terminal state. Tracker creation stays manual
// (the user's Refresh button) to keep the free-tier 10/month under their control.
export async function runDeliveryPoll(): Promise<void> {
  if (!ship24Enabled()) return;
  const active = await prisma.purchase.findMany({
    where: {
      ship24TrackerId: { not: null },
      status: { notIn: ['DELIVERED', 'CANCELLED'] },
    },
    take: 200,
  });
  if (active.length === 0) return;

  logger.info('delivery poll: refreshing trackers', { count: active.length });
  for (const purchase of active) {
    try {
      await syncPurchaseDelivery(purchase);
    } catch (err: any) {
      logger.warn('delivery poll: tracker refresh failed', { purchaseId: purchase.id, error: err?.message });
    }
  }
}

export function startDeliveryPoller(): void {
  if (!ship24Enabled()) {
    logger.info('Ship24 not configured — delivery poller disabled');
    return;
  }
  // Twice daily (09:00 and 18:00). Polling existing trackers is free.
  cron.schedule('0 9,18 * * *', () => {
    runDeliveryPoll().catch((err) => logger.error('delivery poll failed', { error: err?.message }));
  });
  logger.info('delivery poller scheduled (09:00 & 18:00)');
}
