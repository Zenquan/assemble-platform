import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentTypeFor, INDEX_FILE, resolveStaticPath } from '../src/static.js';

const STATIC_ROOT = resolve(process.cwd(), '.gateway-static-test-root');

describe('resolveStaticPath', () => {
  it('根路径与 /index.html 都收敛到静态根目录的 index.html', () => {
    expect(resolveStaticPath('/', STATIC_ROOT)).toBe(join(STATIC_ROOT, INDEX_FILE));
    expect(resolveStaticPath('/index.html', STATIC_ROOT)).toBe(join(STATIC_ROOT, INDEX_FILE));
  });

  it('Vite 产物路径按原样映射到 assets 目录', () => {
    expect(resolveStaticPath('/assets/index-VnNIVeUc.js', STATIC_ROOT)).toBe(
      join(STATIC_ROOT, 'assets', 'index-VnNIVeUc.js'),
    );
  });

  it('多斜杠不会被当成根路径逃逸', () => {
    expect(resolveStaticPath('//etc/passwd', STATIC_ROOT)).toBe(join(STATIC_ROOT, 'etc', 'passwd'));
  });

  it('含 .. 的路径越出静态根时返回 null', () => {
    expect(resolveStaticPath('/../package.json', STATIC_ROOT)).toBeNull();
    expect(resolveStaticPath('/assets/../../package.json', STATIC_ROOT)).toBeNull();
    expect(resolveStaticPath('/%2e%2e/package.json', STATIC_ROOT)).toBeNull();
  });

  it('非法 URL 编码返回 null 而不是抛错', () => {
    expect(resolveStaticPath('/%E0%A4%A', STATIC_ROOT)).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('html/js/css 等前端产物有明确 MIME', () => {
    expect(contentTypeFor('index.html')).toContain('text/html');
    expect(contentTypeFor('index.js')).toContain('text/javascript');
    expect(contentTypeFor('index.css')).toContain('text/css');
    expect(contentTypeFor('favicon.svg')).toBe('image/svg+xml');
  });

  it('未知扩展名回落为二进制流', () => {
    expect(contentTypeFor('model.glb')).toBe('application/octet-stream');
  });
});
