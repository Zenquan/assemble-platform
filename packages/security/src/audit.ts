/**
 * append-only 审计哈希链 —— 轻量防篡改，零外部依赖（只用 node:crypto）。
 *
 * 每条审计记录 `hash = SHA256(canonical([prevHash, id, ts, actorId, action,
 * resource, detail, ip]))`，并携带 `prevHash` 指向上一跳（首条指向 GENESIS）。
 * 任意一条被篡改都会使后续链条校验失败，实现「不可变审计日志」（方案 §7.3）。
 */
import { createHash } from 'node:crypto';
import type { AuditLogEntry } from '@assemble/domain';

/** 链首锚点：首条审计记录的 prevHash */
export const AUDIT_GENESIS = 'GENESIS';

/**
 * 计算某条记录的链摘要。只取业务字段，显式忽略 entry.hash（避免自引用），
 * prevHash 作为入参参与哈希。
 */
export function hashEntry(entry: AuditLogEntry, prevHash: string): string {
  const canonical = JSON.stringify([
    prevHash,
    entry.id,
    entry.ts,
    entry.actorId,
    entry.action,
    entry.resource,
    entry.detail,
    entry.ip ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** 给定已排序的审计列表，返回下一条记录应使用的 prevHash（空列表返回 GENESIS）。 */
export function nextPrevHash(entries: readonly AuditLogEntry[]): string {
  const last = entries[entries.length - 1];
  return last?.hash ?? AUDIT_GENESIS;
}

/** 全链校验：逐条重算摘要并比对 prevHash 链接，任一断裂/篡改即返回 false。 */
export function verifyAuditChain(entries: readonly AuditLogEntry[]): boolean {
  let prev = AUDIT_GENESIS;
  for (const entry of entries) {
    if (entry.prevHash !== prev) return false;
    const expected = hashEntry(entry, prev);
    if (entry.hash !== expected) return false;
    prev = expected;
  }
  return true;
}
