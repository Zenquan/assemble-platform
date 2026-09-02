import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * 通用仓储接口 —— 服务对持久化介质的唯一抽象。
 * 上层业务只依赖该接口，具体介质（内存 / 文件 / 未来 MySQL/Redis）由工厂按配置注入，
 * 从而支持「本地降级」：连不上中间件时自动回落到内存/文件，保证本地能起。
 */
export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  upsert(item: T): Promise<T>;
  delete(id: string): Promise<boolean>;
}

/** 内存 + 可选 JSON 文件快照的实现（降级/本地默认） */
export class MemoryFileRepository<T extends { id: string }>
  implements Repository<T>
{
  private map = new Map<string, T>();
  private filePath?: string;
  private loaded = false;

  constructor(opts: { filePath?: string } = {}) {
    this.filePath = opts.filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded || !this.filePath) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const arr = JSON.parse(raw) as T[];
      for (const it of arr) this.map.set(it.id, it);
    } catch {
      /* 无快照则从空开始 */
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(Array.from(this.map.values()), null, 2),
      'utf8',
    );
  }

  async list(): Promise<T[]> {
    await this.ensureLoaded();
    return Array.from(this.map.values());
  }

  async get(id: string): Promise<T | undefined> {
    await this.ensureLoaded();
    return this.map.get(id);
  }

  async upsert(item: T): Promise<T> {
    await this.ensureLoaded();
    this.map.set(item.id, item);
    await this.persist();
    return item;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const ok = this.map.delete(id);
    if (ok) await this.persist();
    return ok;
  }
}

export type StorageBackend = 'memory' | 'file';

export interface StorageFactoryOptions {
  backend: StorageBackend;
  /** 当 backend='file' 时的数据目录 */
  dataDir?: string;
}

/**
 * 按运行环境选择介质。生产建议接 MySQL/Redis（Docker 起），
 * 本地/测试无中间件时回落 memory 或 file，保证一键可跑。
 */
export function resolveBackend(env = process.env): StorageBackend {
  const mode = env['ASSEMBLE_STORAGE']?.toLowerCase();
  if (mode === 'file') return 'file';
  if (mode === 'memory') return 'memory';
  // 默认：有 DATABASE_URL 视为有中间件（后续接真库），否则降级 memory
  return env['ASSEMBLE_DATABASE_URL'] ? 'memory' : 'memory';
}

export function createMemoryRepo<T extends { id: string }>(): Repository<T> {
  return new MemoryFileRepository<T>();
}

export function createFileRepo<T extends { id: string }>(
  filePath: string,
): Repository<T> {
  return new MemoryFileRepository<T>({ filePath });
}

export function createRepo<T extends { id: string }>(
  opts: StorageFactoryOptions,
  collection: string,
): Repository<T> {
  if (opts.backend === 'file' && opts.dataDir) {
    return createFileRepo<T>(path.join(opts.dataDir, `${collection}.json`));
  }
  return createMemoryRepo<T>();
}
