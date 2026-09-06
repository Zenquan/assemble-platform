/**
 * gateway 静态资源托管 —— 单容器部署形态下同源服务 sim-platform 的 Vite 产物。
 *
 * 只服务 GET/HEAD；API 前缀仍由 routing.ts 优先进上游，静态兜底仅处理
 * 未匹配 API 的路径（`/`、`/index.html`、`/assets/*` 等）。
 * 路径解析做解码 + 根目录包含校验，杜绝 `..` 越权读到镜像内其它文件。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { logJson } from './observability.js';

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const INDEX_FILE = 'index.html';

/** 按扩展名返回 Content-Type；未知类型统一走二进制流 */
export function contentTypeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * 把请求 pathname 安全映射到 staticRoot 下的文件路径。
 * 未命中/越权返回 null；`/` 与 `/index.html` 都收敛到 index.html。
 */
export function resolveStaticPath(pathname: string, staticRoot: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const root = resolve(staticRoot);
  const relative = decoded === '/' ? INDEX_FILE : decoded.replace(/^\/+/, '');
  if (!relative) return null;

  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  return candidate === root ? resolve(root, INDEX_FILE) : candidate;
}

/**
 * 尝试静态响应；请求不是 GET/HEAD、路径越权或文件不存在时返回 false，
 * 由调用方继续走原 404 信封，避免吞掉路由语义。
 */
export async function tryServeStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  staticRoot: string,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return false;

  const filePath = resolveStaticPath(pathname, staticRoot);
  if (!filePath) return false;

  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': String(info.size),
    'Cache-Control': filePath.endsWith(INDEX_FILE) ? 'no-cache' : 'public, max-age=3600',
  });
  if (method === 'HEAD') {
    res.end();
    return true;
  }

  const stream = createReadStream(filePath);
  stream.on('error', (err) => {
    logJson('error', 'static read error', { file: filePath, error: err.message });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 'STATIC_READ_ERROR', message: '静态资源读取失败' }));
      return;
    }
    res.destroy();
  });
  stream.pipe(res);
  return true;
}
