import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  backupFileName,
  parseBackupName,
  selectForDeletion,
  safeBackupPath,
  timestampToken,
  BACKUP_DIR,
} from './backup';

describe('timestampToken', () => {
  it('formats a UTC instant as YYYYMMDD-HHMMSS', () => {
    expect(timestampToken(new Date('2026-07-01T00:38:56.815Z'))).toBe('20260701-003856');
  });
});

describe('backupFileName / parseBackupName round-trip', () => {
  const when = new Date('2026-07-01T03:00:00.000Z');

  it('builds and parses auto/manual/pre-import names', () => {
    expect(backupFileName('auto', when)).toBe('trackit-20260701-030000-auto.dump');
    expect(backupFileName('manual', when)).toBe('trackit-20260701-030000-manual.dump');
    expect(backupFileName('pre-import', when)).toBe('preimport-20260701-030000.dump');

    expect(parseBackupName('trackit-20260701-030000-auto.dump')).toEqual({ kind: 'auto', ts: '20260701-030000' });
    expect(parseBackupName('trackit-20260701-030000-manual.dump')).toEqual({ kind: 'manual', ts: '20260701-030000' });
    expect(parseBackupName('preimport-20260701-030000.dump')).toEqual({ kind: 'pre-import', ts: '20260701-030000' });
  });

  it('rejects foreign / malformed / traversal names', () => {
    expect(parseBackupName('random.sql')).toBeNull();
    expect(parseBackupName('trackit-2026-auto.dump')).toBeNull();
    expect(parseBackupName('../../etc/passwd')).toBeNull();
    expect(parseBackupName('trackit-20260701-030000-evil.dump')).toBeNull();
  });
});

describe('selectForDeletion', () => {
  const mk = (name: string, kind: any, sort: number) => ({ name, kind, sort });

  it('keeps the newest N normal dumps and prunes the rest', () => {
    const items = [
      mk('a', 'auto', 5),
      mk('b', 'manual', 4),
      mk('c', 'auto', 3),
      mk('d', 'auto', 2),
      mk('e', 'manual', 1),
    ];
    // keep 2 newest normal → a(5), b(4) kept; c,d,e deleted
    expect(selectForDeletion(items, 2, 10).sort()).toEqual(['c', 'd', 'e']);
  });

  it('rotates normal and pre-import groups independently', () => {
    const items = [
      mk('n1', 'auto', 10),
      mk('n2', 'auto', 9),
      mk('p1', 'pre-import', 8),
      mk('p2', 'pre-import', 7),
      mk('p3', 'pre-import', 6),
    ];
    // keep 1 normal (n1) + keep 2 pre-import (p1,p2) → delete n2, p3
    expect(selectForDeletion(items, 1, 2).sort()).toEqual(['n2', 'p3']);
  });

  it('deletes nothing when under the limits', () => {
    const items = [mk('a', 'auto', 2), mk('b', 'pre-import', 1)];
    expect(selectForDeletion(items, 30, 10)).toEqual([]);
  });
});

describe('safeBackupPath', () => {
  it('accepts a valid backup name', () => {
    expect(safeBackupPath('trackit-20260701-030000-auto.dump')).toBe(path.join(BACKUP_DIR, 'trackit-20260701-030000-auto.dump'));
  });

  it('rejects traversal and non-backup names', () => {
    expect(() => safeBackupPath('../secret')).toThrow();
    expect(() => safeBackupPath('/etc/passwd')).toThrow();
    expect(() => safeBackupPath('trackit-20260701-030000-auto.dump.evil')).toThrow();
  });
});
