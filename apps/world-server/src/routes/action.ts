import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Command, Gait, World } from '@wa/sim';
import { apiError } from '../errors.ts';
import { bearerToken, readJson, sendError, sendJson } from '../http.ts';
import type { Spec } from '../spec.ts';
import type { TokenTable } from '../tokens.ts';

/** Action types this build can carry out. The rest validate against the spec, then are refused. */
const AVAILABLE = new Set(['move', 'stop']);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * POST /v1/action, sprint 1 slice: authenticates a dev agent, validates the body against
 * openapi.yaml and applies `move` or `stop` to the world. Idempotency, rate limits and the other
 * action types arrive with WA-504 and WA-505.
 */
export function actionRoute(deps: { world: World; spec: Spec; tokens: TokenTable }) {
  const { world, spec, tokens } = deps;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const agentId = tokens.agentFor(bearerToken(req));
    if (!agentId) {
      sendError(res, apiError('UNAUTHORIZED', 'Missing or unknown bearer token.'));
      return;
    }
    const parsed = await readJson(req);
    if (!parsed.ok) {
      sendError(res, apiError('VALIDATION', parsed.message, { details: { path: '' } }));
      return;
    }
    const body = parsed.value as Record<string, unknown>;
    const requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;
    const check = spec.checkAction(body);
    if (!check.ok) {
      sendError(res, apiError('VALIDATION', `${check.path || 'body'}: ${check.message}`, { requestId, details: { path: check.path } }));
      return;
    }
    if (!AVAILABLE.has(check.type)) {
      sendError(
        res,
        apiError('VALIDATION', `Action "${check.type}" is not available in this build yet. Available: ${[...AVAILABLE].join(', ')}.`, {
          requestId,
          details: { path: '/type' },
        }),
      );
      return;
    }

    const command: Command =
      check.type === 'move'
        ? { type: 'move', to: body.to as Extract<Command, { type: 'move' }>['to'], gait: (body.gait as Gait | undefined) ?? undefined }
        : { type: 'stop' };
    if (command.type === 'move' && command.gait === undefined) delete command.gait;

    const outcome = world.apply(agentId, command);
    if (!outcome.ok) {
      sendError(res, apiError(outcome.code, outcome.message, { requestId, details: outcome.details }));
      return;
    }
    if (outcome.kind !== 'order') throw new Error(`unexpected outcome kind ${outcome.kind}`);
    const self = world.getAgent(agentId);
    sendJson(res, 200, {
      ok: true,
      requestId,
      replayed: false,
      kind: 'order',
      order: outcome.order,
      ...(self ? { self: { pos: { x: round2(self.pos.x), y: round2(self.pos.y) } } } : {}),
      attention: null,
      cursor: `e_${world.lastEventSeq}`,
    });
  };
}
