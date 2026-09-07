/**
 * 轻量字段加密与密钥派生 —— 零外部依赖（只用 node:crypto）。
 *
 * - `encryptString` / `decryptString`：AES-256-GCM（带认证标签，防篡改），
 *   输出 `base64(iv ‖ tag ‖ ciphertext)`，适合审计 detail 等敏感字段静态加密。
 * - `deriveKey`：scrypt 从口令派生 32 字节密钥（密码哈希/密钥治理用）。
 * - `constantTimeEqual`：常量时间比较，防时序侧信道。
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const IV_LENGTH = 12; // GCM 推荐 96-bit IV
const TAG_LENGTH = 16; // GCM 认证标签 128-bit

function toBuffer(input: string | Buffer): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
}

/** AES-256-GCM 加密，返回 base64(iv ‖ tag ‖ ciphertext)。key 需为 32 字节。 */
export function encryptString(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** AES-256-GCM 解密 encryptString 的输出；密钥/密文被篡改时抛错。 */
export function decryptString(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** scrypt 口令派生（默认 32 字节密钥；密码哈希/密钥治理用） */
export function deriveKey(secret: string, salt: Buffer, keyLengthBytes = 32): Buffer {
  return scryptSync(secret, salt, keyLengthBytes);
}

/** 常量时间比较（长度不等直接 false，长度相等走 timingSafeEqual） */
export function constantTimeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = toBuffer(a);
  const bb = toBuffer(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 密码学安全随机串（token / 盐 / 密钥材料） */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
