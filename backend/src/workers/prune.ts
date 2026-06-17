import { prisma } from '../config/database';
import logger from '../utils/logger';

/**
 * Retention/pruning for the unbounded-growth tables. ScraperLog is written on
 * every check (every listing, every cycle) so it grows fast and is pruned
 * aggressively; StockEvent is the price-history feature (only written on change)
 * so it's kept much longer. Both windows are env-tunable; 0 disables that table.
 */

const DAY_MS = 86_400_000;

/** Cutoff date for a retention window, or null when disabled (days <= 0). */
export function retentionCutoff(days: number, now: number = Date.now()): Date | null {
  return days > 0 ? new Date(now - days * DAY_MS) : null;
}

export async function pruneOldRecords(): Promise<void> {
  const scraperLogDays = parseInt(process.env.SCRAPER_LOG_RETENTION_DAYS || '30', 10);
  const stockEventDays = parseInt(process.env.STOCK_EVENT_RETENTION_DAYS || '365', 10);

  try {
    const logCutoff = retentionCutoff(scraperLogDays);
    if (logCutoff) {
      const { count } = await prisma.scraperLog.deleteMany({ where: { createdAt: { lt: logCutoff } } });
      if (count > 0) logger.info('pruned old scraper logs', { count, olderThanDays: scraperLogDays });
    }

    const eventCutoff = retentionCutoff(stockEventDays);
    if (eventCutoff) {
      const { count } = await prisma.stockEvent.deleteMany({ where: { createdAt: { lt: eventCutoff } } });
      if (count > 0) logger.info('pruned old stock events', { count, olderThanDays: stockEventDays });
    }
  } catch (err: any) {
    // Non-critical housekeeping — never let it crash the process.
    logger.error('pruneOldRecords failed', { error: err.message });
  }
}
