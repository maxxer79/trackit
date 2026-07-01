/**
 * Database backup / restore service.
 *
 * This app does NOT use `prisma migrate`; likewise backups are plain Postgres
 * dumps taken with the pg client tools (installed in the backend image). Dumps
 * are written to BACKUP_DIR (a mounted volume so they survive container
 * restarts) in custom format (`pg_dump -Fc`, extension `.dump`), which restores
 * with `pg_restore --clean`.
 *
 * File naming (timestamp is UTC, YYYYMMDD-HHMMSS):
 *   trackit-<ts>-auto.dump     scheduled nightly backup
 *   trackit-<ts>-manual.dump   admin pressed "Back up now"
 *   preimport-<ts>.dump        automatic safety snapshot taken before an import
 *
 * Rotation keeps the newest BACKUP_RETENTION normal dumps (auto+manual) and the
 * newest PRE_IMPORT_KEEP safety snapshots; everything older is pruned.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import logger from '../utils/logger';

const execFileP = promisify(execFile);
const EXEC_OPTS = { maxBuffer: 1024 * 1024 * 128 } as const;

export const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
export const PRE_IMPORT_KEEP = 10;

export type BackupKind = 'auto' | 'manual' | 'pre-import';

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  createdAt: string; // ISO
  size: number; // bytes
}

export function retention(): number {
  const n = parseInt(process.env.BACKUP_RETENTION || '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function backupCron(): string {
  return process.env.BACKUP_CRON || '0 3 * * *';
}

function dbUrl(): string {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL is not set');
  return u;
}

/** UTC timestamp token: YYYYMMDD-HHMMSS. */
export function timestampToken(when: Date = new Date()): string {
  return when.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export function backupFileName(kind: BackupKind, when: Date = new Date()): string {
  const ts = timestampToken(when);
  return kind === 'pre-import' ? `preimport-${ts}.dump` : `trackit-${ts}-${kind}.dump`;
}

const NAME_RE = /^(?:trackit-(\d{8}-\d{6})-(auto|manual)|preimport-(\d{8}-\d{6}))\.dump$/;

/** Parse a backup filename; returns null for anything that isn't one of ours. */
export function parseBackupName(name: string): { kind: BackupKind; ts: string } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  if (m[3]) return { kind: 'pre-import', ts: m[3] };
  return { kind: m[2] as BackupKind, ts: m[1] };
}

/**
 * Given all backups, return the names to delete: keep the newest `keepNormal`
 * auto+manual dumps and the newest `keepPreImport` safety snapshots. Pure &
 * unit-tested — no filesystem access.
 */
export function selectForDeletion(
  items: { name: string; kind: BackupKind; sort: number }[],
  keepNormal: number,
  keepPreImport: number
): string[] {
  const byNewest = (a: { sort: number }, b: { sort: number }) => b.sort - a.sort;
  const normal = items.filter((i) => i.kind !== 'pre-import').sort(byNewest);
  const pre = items.filter((i) => i.kind === 'pre-import').sort(byNewest);
  return [...normal.slice(keepNormal), ...pre.slice(keepPreImport)].map((i) => i.name);
}

/** Resolve a user-supplied backup name to a path, rejecting traversal. */
export function safeBackupPath(name: string): string {
  const base = path.basename(name);
  if (base !== name || !parseBackupName(base)) {
    throw new Error('Invalid backup name');
  }
  return path.join(BACKUP_DIR, base);
}

async function ensureDir(): Promise<void> {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

export async function listBackups(): Promise<BackupInfo[]> {
  await ensureDir();
  const files = await fsp.readdir(BACKUP_DIR);
  const infos: BackupInfo[] = [];
  for (const f of files) {
    const parsed = parseBackupName(f);
    if (!parsed) continue;
    try {
      const st = await fsp.stat(path.join(BACKUP_DIR, f));
      infos.push({ name: f, kind: parsed.kind, createdAt: st.mtime.toISOString(), size: st.size });
    } catch {
      /* file vanished between readdir and stat — ignore */
    }
  }
  return infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function rotate(): Promise<void> {
  const infos = await listBackups();
  const del = selectForDeletion(
    infos.map((i) => ({ name: i.name, kind: i.kind, sort: Date.parse(i.createdAt) })),
    retention(),
    PRE_IMPORT_KEEP
  );
  for (const name of del) {
    await fsp.unlink(path.join(BACKUP_DIR, name)).catch(() => {});
  }
  if (del.length) logger.info('backup rotation pruned old dumps', { pruned: del.length });
}

/** Take a pg_dump (custom format) into BACKUP_DIR, then rotate. */
export async function runBackup(kind: BackupKind = 'manual'): Promise<BackupInfo> {
  await ensureDir();
  const name = backupFileName(kind);
  const out = path.join(BACKUP_DIR, name);
  await execFileP('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-f', out, dbUrl()], EXEC_OPTS);
  const st = await fsp.stat(out);
  logger.info('backup created', { name, kind, size: st.size });
  await rotate().catch((e) => logger.warn('backup rotation failed', { error: e?.message }));
  return { name, kind, createdAt: st.mtime.toISOString(), size: st.size };
}

export async function getStatus(): Promise<{
  last: BackupInfo | null;
  count: number;
  totalSize: number;
  retention: number;
  schedule: string;
  dir: string;
  backups: BackupInfo[];
}> {
  const backups = await listBackups();
  const normal = backups.filter((b) => b.kind !== 'pre-import');
  return {
    last: normal[0] ?? backups[0] ?? null,
    count: backups.length,
    totalSize: backups.reduce((s, b) => s + b.size, 0),
    retention: retention(),
    schedule: backupCron(),
    dir: BACKUP_DIR,
    backups,
  };
}

/**
 * Restore the database from an uploaded dump. Takes an automatic safety
 * snapshot FIRST (so a bad import is always recoverable), then restores.
 * Supports custom-format `.dump` (pg_restore) and plain `.sql` (psql).
 */
export async function importDump(
  buffer: Buffer,
  originalName: string
): Promise<{ snapshot: BackupInfo; restored: string }> {
  await ensureDir();
  const snapshot = await runBackup('pre-import');

  const isSql = /\.sql$/i.test(originalName);
  const tmp = path.join(os.tmpdir(), `trackit-import-${Date.now()}${isSql ? '.sql' : '.dump'}`);
  await fsp.writeFile(tmp, buffer);
  try {
    if (isSql) {
      await execFileP('psql', [dbUrl(), '-v', 'ON_ERROR_STOP=1', '-f', tmp], EXEC_OPTS);
    } else {
      await execFileP(
        'pg_restore',
        ['--clean', '--if-exists', '--no-owner', '--no-privileges', '-d', dbUrl(), tmp],
        EXEC_OPTS
      );
    }
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
  logger.warn('database import completed', { originalName, snapshot: snapshot.name });
  return { snapshot, restored: originalName };
}
