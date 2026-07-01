import cron from 'node-cron';
import { runBackup, backupCron, retention } from '../services/backup';
import logger from '../utils/logger';

/**
 * Scheduled database backups. Runs `pg_dump` on the BACKUP_CRON schedule
 * (default nightly 03:00) and prunes to BACKUP_RETENTION. Set
 * BACKUP_ENABLED=false to disable the automatic run (manual backups from the
 * admin panel still work).
 */
export function startBackupScheduler(): void {
  if (process.env.BACKUP_ENABLED === 'false') {
    logger.info('scheduled backups disabled (BACKUP_ENABLED=false)');
    return;
  }
  const expr = backupCron();
  if (!cron.validate(expr)) {
    logger.error(`invalid BACKUP_CRON "${expr}" — scheduled backups NOT started`);
    return;
  }
  cron.schedule(expr, () => {
    runBackup('auto').catch((err) => logger.error('scheduled backup failed', { error: err?.message }));
  });
  logger.info(`backup scheduler active (${expr}, keep ${retention()})`);
}
