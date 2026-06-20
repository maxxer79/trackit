import cron from 'node-cron';
import { prisma } from '../config/database';
import logger from '../utils/logger';

// Auto-archive trackings whose product hasn't come back in stock in N months.
// Archiving only hides the item from the main dashboard — it's fully restorable
// and tracking history is untouched. Gated by AUTO_ARCHIVE_MONTHS (0 disables).
const IN_STOCK = ['IN_STOCK', 'LIMITED', 'PREORDER'];

export function autoArchiveMonths(): number {
  const n = parseInt(process.env.AUTO_ARCHIVE_MONTHS || '6', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function runAutoArchive(): Promise<void> {
  const months = autoArchiveMonths();
  if (months === 0) return;
  const cutoff = new Date(Date.now() - months * 30 * 86_400_000);

  // Only consider trackings that have existed at least this long (don't archive
  // something the user just started tracking) and aren't already archived.
  const candidates = await prisma.tracking.findMany({
    where: { isActive: true, archivedAt: null, createdAt: { lt: cutoff } },
    select: { id: true, productId: true },
    take: 5000,
  });
  if (candidates.length === 0) return;

  const toArchive: string[] = [];
  for (const t of candidates) {
    const recentRestock = await prisma.stockEvent.findFirst({
      where: { productId: t.productId, status: { in: IN_STOCK }, createdAt: { gte: cutoff } },
      select: { id: true },
    });
    if (!recentRestock) toArchive.push(t.id);
  }

  if (toArchive.length > 0) {
    const result = await prisma.tracking.updateMany({
      where: { id: { in: toArchive } },
      data: { archivedAt: new Date() },
    });
    logger.info('auto-archived stale trackings', { count: result.count, months });
  }
}

export function startAutoArchive(): void {
  if (autoArchiveMonths() === 0) {
    logger.info('auto-archive disabled (AUTO_ARCHIVE_MONTHS=0)');
    return;
  }
  // Daily at 03:30.
  cron.schedule('30 3 * * *', () => {
    runAutoArchive().catch((err) => logger.error('auto-archive failed', { error: err?.message }));
  });
  logger.info(`auto-archive scheduled (daily, ${autoArchiveMonths()} months)`);
}
