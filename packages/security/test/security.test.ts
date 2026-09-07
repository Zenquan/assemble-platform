/**
 * @assemble/security 单测 —— JWT 签发/验证、AES-256-GCM 往返、RBAC 矩阵、审计哈希链。
 */
import { describe, expect, it } from 'vitest';

import {
  AUDIT_GENESIS,
  constantTimeEqual,
  decryptString,
  deriveKey,
  encryptString,
  extractBearerToken,
  hashEntry,
  hasPermission,
  nextPrevHash,
  permissionsFor,
  randomToken,
  resolveJwtSecret,
  signJwt,
  verifyAuditChain,
  verifyJwt,
} from '../src/index.js';
import type { AuditLogEntry } from '@assemble/domain';

const SECRET = 'test-secret-32-bytes-0000000000';

describe('jwt · HS256 签发与验证', () => {
  it('签发后可验签还原 payload，且补 iat/exp', () => {
    const token = signJwt({ sub: 'u1', role: 'viewer' }, SECRET, { ttlSeconds: 3600 });
    expect(token.split('.')).toHaveLength(3);
    const claims = verifyJwt(token, SECRET);
    expect(claims['sub']).toBe('u1');
    expect(claims['role']).toBe('viewer');
    expect(typeof claims['iat']).toBe('number');
    expect(typeof claims['exp']).toBe('number');
  });

  it('篡改 payload 或签名必被拒', () => {
    const token = signJwt({ sub: 'u1' }, SECRET);
    const [h, b, s] = token.split('.') as [string, string, string];
    const tamperedBody = Buffer.from(JSON.stringify({ sub: 'u1', role: 'super_admin', iat: 1, exp: 9999999999 })).toString('base64url');
    const tampered = `${h}.${tamperedBody}.${s}`;
    expect(() => verifyJwt(tampered, SECRET)).toThrow();

    const badSig = `${h}.${b}.${'A'.repeat(43)}`;
    expect(() => verifyJwt(badSig, SECRET)).toThrow();
  });

  it('过期 token 被拒（可注入 nowSeconds）', () => {
    const token = signJwt({ sub: 'u1' }, SECRET, { ttlSeconds: 10 });
    const now = Math.floor(Date.now() / 1000) + 100;
    expect(() => verifyJwt(token, SECRET, { nowSeconds: now })).toThrow(/过期/);
  });

  it('签发者不匹配被拒', () => {
    const token = signJwt({ sub: 'u1' }, SECRET, { issuer: 'auth-svc' });
    expect(() => verifyJwt(token, SECRET, { issuer: 'other' })).toThrow(/签发者/);
    expect(verifyJwt(token, SECRET, { issuer: 'auth-svc' })).toBeDefined();
  });

  it('非法格式 / 错误密钥被拒', () => {
    expect(() => verifyJwt('not-a-jwt', SECRET)).toThrow();
    const token = signJwt({ sub: 'u1' }, SECRET);
    expect(() => verifyJwt(token, 'wrong-secret')).toThrow(/签名/);
  });

  it('extractBearerToken 提取/拒绝各种形态', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('Bearer  abc  ')).toBe('abc');
    expect(extractBearerToken('Basic abc')).toBeUndefined();
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('')).toBeUndefined();
  });

  it('resolveJwtSecret：显式密钥 / 开发回退 / 生产强约束', () => {
    expect(resolveJwtSecret({ nodeEnv: 'production', explicit: 'x'.repeat(32) }).secret).toBe('x'.repeat(32));
    expect(resolveJwtSecret({ nodeEnv: 'production', explicit: 'x'.repeat(32) }).usingDev).toBe(false);
    expect(() => resolveJwtSecret({ nodeEnv: 'production' })).toThrow(/必须显式配置/);
    expect(() => resolveJwtSecret({ nodeEnv: 'production', explicit: 'short' })).toThrow(/< 32/);
    const dev = resolveJwtSecret({ nodeEnv: 'development' });
    expect(dev.usingDev).toBe(true);
    expect(dev.isProd).toBe(false);
    expect(dev.secret.length).toBeGreaterThanOrEqual(32);
  });
});

describe('crypto · AES-256-GCM + 派生 + 常量时间', () => {
  it('加解密往返一致；密钥/密文篡改被拒', () => {
    const key = deriveKey(SECRET, Buffer.from('salt-16-bytes!!'));
    expect(key.length).toBe(32);
    const cipher = encryptString('敏感字段：工艺参数', key);
    expect(cipher).not.toContain('工艺参数');
    expect(decryptString(cipher, key)).toBe('敏感字段：工艺参数');

    const otherKey = deriveKey('another-secret', Buffer.from('salt-16-bytes!!'));
    expect(() => decryptString(cipher, otherKey)).toThrow();
  });

  it('常量时间比较：相等 true，长度不等 false，内容不等 false', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('randomToken 长度与随机性', () => {
    const a = randomToken(16);
    const b = randomToken(16);
    expect(a).toHaveLength(32); // 16 bytes → 32 hex chars
    expect(a).not.toBe(b);
  });
});

describe('rbac · 授权单一事实源', () => {
  it('super_admin 全量、viewer 只读、未知角色空集', () => {
    expect(permissionsFor('super_admin')).toContain('user:manage');
    expect(permissionsFor('viewer')).toEqual(['line:read']);
    expect(hasPermission(['viewer'], 'line:read')).toBe(true);
    expect(hasPermission(['viewer'], 'line:write')).toBe(false);
    expect(hasPermission(['super_admin'], 'user:manage')).toBe(true);
  });
});

describe('audit · append-only 哈希链', () => {
  function entry(partial: Partial<AuditLogEntry> & { id: string; ts: string; actorId: string; action: string; resource: string; detail: string }): AuditLogEntry {
    return partial;
  }

  it('nextPrevHash 空列表返回 GENESIS，否则取末条 hash', () => {
    expect(nextPrevHash([])).toBe(AUDIT_GENESIS);
    const e = entry({ id: 'a', ts: 't', actorId: 'u', action: 'x', resource: 'r', detail: 'd', hash: 'H1', prevHash: AUDIT_GENESIS });
    expect(nextPrevHash([e])).toBe('H1');
  });

  it('完整链 verifyAuditChain 通过；篡改任一条目失败', () => {
    const chain: AuditLogEntry[] = [];
    let prev = AUDIT_GENESIS;
    for (let i = 0; i < 3; i++) {
      const e = entry({
        id: `audit-${i}`,
        ts: `2026-09-07T00:00:0${i}Z`,
        actorId: 'u1',
        action: 'token.issue',
        resource: 'auth',
        detail: `d${i}`,
        prevHash: prev,
      });
      e.hash = hashEntry(e, prev);
      chain.push(e);
      prev = e.hash;
    }
    expect(verifyAuditChain(chain)).toBe(true);

    const tampered = chain.map((e, i) => (i === 1 ? { ...e, detail: '篡改' } : e));
    expect(verifyAuditChain(tampered)).toBe(false);
  });

  it('链首 prevHash 非 GENESIS 即校验失败', () => {
    const e = entry({ id: 'a', ts: 't', actorId: 'u', action: 'x', resource: 'r', detail: 'd', prevHash: 'WRONG', hash: 'X' });
    expect(verifyAuditChain([e])).toBe(false);
  });
});
