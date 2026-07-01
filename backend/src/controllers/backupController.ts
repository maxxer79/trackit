import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as backup from '../services/backup';
import logger from '../utils/logger';

export async function getBackupStatus(_req: AuthRequest, res: Response): Promise<void> {
  try {
    res.json(await backup.getStatus());
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to read backup status', detail: e?.message });
  }
}

export async function runBackupNow(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const info = await backup.runBackup('manual');
    res.json({ message: 'Backup complete', backup: info });
  } catch (e: any) {
    logger.error('manual backup failed', { error: e?.message });
    res.status(500).json({ error: 'Backup failed', detail: e?.message });
  }
}

export async function exportBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    let name = String(req.query.name || '');
    if (!name) {
      const status = await backup.getStatus();
      if (!status.last) {
        res.status(404).json({ error: 'No backups available yet' });
        return;
      }
      name = status.last.name;
    }
    const filePath = backup.safeBackupPath(name);
    res.download(filePath, name);
  } catch (e: any) {
    res.status(400).json({ error: 'Invalid export request', detail: e?.message });
  }
}

export async function importBackup(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (String(req.query.confirm || '') !== 'CONFIRM') {
      res.status(400).json({ error: 'Type CONFIRM to import — this overwrites the live database' });
      return;
    }
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const filename = String(req.query.filename || 'upload.dump');
    const result = await backup.importDump(buf, filename);
    res.json({ message: 'Import complete — database restored', ...result });
  } catch (e: any) {
    logger.error('database import failed', { error: e?.message });
    res.status(500).json({
      error: 'Import failed — your data was NOT changed; a safety snapshot was taken before restore',
      detail: e?.message,
    });
  }
}
