import { errToStatus } from '@assemble/http';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { createAssemblyRepos, type AssemblyRepos } from './repositories/index.js';
import { registerLineRoutes } from './routes/lines.js';

export interface AppDeps {
  repos: AssemblyRepos;
}

/**
 * 构建装配服务应用（不 listen，便于注入测试/网关托管）。
 * 统一错误处理：业务抛出的信封错误转对应 HTTP 状态。
 */
export function buildApp(deps?: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const repos = deps?.repos ?? createAssemblyRepos();

  app.addHook('onSend', async (_req, reply, payload) => {
    // 让信封错误与 reply.status 正确联动：无需处理，保持原样
    void reply;
    return payload;
  });

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'assembly-svc',
    time: new Date().toISOString(),
  }));

  registerLineRoutes(app, repos);

  app.setErrorHandler((error: FastifyError, _req, reply) => {
    const code = error.message ?? 'INTERNAL_ERROR';
    const status = errToStatus(code);
    void reply.status(status >= 400 && status < 500 ? status : 500).send({
      ok: false,
      code,
      message: error.message,
    });
  });

  return app;
}
