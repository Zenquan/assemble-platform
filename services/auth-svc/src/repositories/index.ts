import type { AuditLogEntry } from '@assemble/domain';
import { hashEntry, nextPrevHash } from '@assemble/security';
import { createRepo, resolveBackend, type Repository } from '@assemble/storage';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AuthRepos {
  audit: Repository<AuditLogEntry>;
}

export function createAuthRepos(): AuthRepos {
  const backend = resolveBackend();
  const dataDir =
    process.env['ASSEMBLE_DATA_DIR'] ?? path.resolve(__dirname, '../../.assemble-data');
  return {
    audit: createRepo<AuditLogEntry>({ backend, dataDir }, 'audit-log'),
  };
}

/**
 * 串行化审计写入：append-only 哈希链要求「先读末条 prevHash → 再写新条」原子，
 * 否则并发签发会让两条记录复用同一 prevHash，导致全链校验断裂。
 */
let auditLock: Promise<unknown> = Promise.resolve();

/**
 * 写入一条审计记录并接上哈希链。
 * `hash = SHA256(prevHash + canonical(entry))`，`prevHash` 指向上一条（首条为 GENESIS）。
 */
export async function writeAudit(
  audit: Repository<AuditLogEntry>,
  entry: Omit<AuditLogEntry, 'id' | 'ts' | 'hash' | 'prevHash'>,
): Promise<AuditLogEntry> {
  const run = async (): Promise<AuditLogEntry> => {
    const prevHash = nextPrevHash(await audit.list());
    const id = `audit-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const ts = new Date().toISOString();
    const base: AuditLogEntry = { ...entry, id, ts, prevHash };
    const hash = hashEntry(base, prevHash);
    return audit.upsert({ ...base, hash });
  };

  const result = auditLock.then(run, run);
  auditLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
