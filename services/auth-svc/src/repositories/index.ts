import type { AuditLogEntry } from '@assemble/domain';
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

export async function writeAudit(
  audit: Repository<AuditLogEntry>,
  entry: Omit<AuditLogEntry, 'id' | 'ts'>,
): Promise<void> {
  await audit.upsert({
    ...entry,
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    ts: new Date().toISOString(),
  });
}
