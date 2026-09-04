// scripts/gltf-gen/preview_server.mjs
// 极简静态 HTTP server —— 默认仅绑本机，可由 GLTF_PREVIEW_HOST 覆盖。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)));
const HOST = process.env['GLTF_PREVIEW_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env.PORT || 8773);
const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.glb':'model/gltf-binary',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
};

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/preview.html';
  const abs = path.normalize(path.join(ROOT, p));
  if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'});
    fs.createReadStream(abs).pipe(res);
  });
});
srv.listen(PORT, HOST, () => console.log(`preview-server on http://${HOST}:${PORT}`));
