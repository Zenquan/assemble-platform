import { installGracefulShutdown } from '@assemble/health';
import { buildApp } from './app.js';

const PORT = Number(process.env['PORT'] ?? 7104);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const app = buildApp();

// SIGTERM/SIGINT → readiness 置 down（/readyz 立即 503）→ drain 在途 → app.close() → 退出
installGracefulShutdown(app, app.readinessState, {
  log: (msg) => app.log.info(msg),
});

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`takt-svc listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
