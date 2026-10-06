import { createServer, type Server } from 'node:http';
import type { Rules } from '@wa/rules';
import type { World } from '@wa/sim';
import { apiError } from './errors.ts';
import { notFound, sendError, sendJson } from './http.ts';
import type { Logger } from './log.ts';
import { actionRoute } from './routes/action.ts';
import { rulesRoute } from './routes/rules.ts';
import type { Spec } from './spec.ts';
import type { TokenTable } from './tokens.ts';

export interface AppOptions {
  world: World;
  rules: Rules;
  spec: Spec;
  worldId: string;
  tokens: TokenTable;
  log?: Logger;
}

export interface App {
  server: Server;
}

/** The HTTP API in front of one world. Routing is a plain switch: the API is small and stays explicit. */
export function createApp(opts: AppOptions): App {
  const { world, rules, worldId, log } = opts;
  const rules_ = rulesRoute(rules);
  const action = actionRoute(opts);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const handle = async (): Promise<void> => {
      switch (route) {
        case 'GET /healthz':
          sendJson(res, 200, { ok: true, worldId, tick: world.tick, rulesVersion: rules.rulesVersion });
          return;
        case 'GET /v1/rules':
          rules_(res);
          return;
        case 'POST /v1/action':
          await action(req, res);
          return;
        default:
          notFound(res);
      }
    };
    handle().catch((err: unknown) => {
      log?.error('request failed', { route, err: err instanceof Error ? err.stack : String(err) });
      if (!res.headersSent) sendError(res, apiError('INTERNAL', 'Internal error. Resend the same requestId after a short wait.'));
      else res.end();
    });
  });
  // Long-polls (sprint 2) hold requests up to 20 s; keep idle sockets a little longer than that.
  server.keepAliveTimeout = 25_000;
  return { server };
}
