import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '@wa/rules';
import type { OrderView, Vec2 } from '@wa/sim';
import { assertMatchesSpec, call, DEV_AGENT, startServer, type TestServer } from './helpers.ts';

const tickMs = 1000 / rules.world.tickHz;
let seq = 0;
const rid = (): string => `r-test-${(++seq).toString().padStart(6, '0')}`;

type ActionOk = { ok: true; requestId: string; replayed: boolean; kind: string; order: OrderView; cursor: string };
type ActionErr = { ok: false; requestId?: string; error: { code: string; message: string; details?: Record<string, unknown> } };

describe('WA-203 Movement and pathfinding', () => {
  test('Given a reachable destination, when I send move with gait run, then the response has etaMs and my position updates each tick until arrival', async () => {
    const server = await startServer();
    try {
      const dest = server.world.map.pois.find((p) => p.kind === 'monument')!;
      const requestId = rid();
      const res = await call(server, 'POST', '/v1/action', { body: { requestId, type: 'move', to: { poiId: dest.id }, gait: 'run' } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assertMatchesSpec('post', '/v1/action', 200, res.body);
      const body = res.body as ActionOk;
      assert.equal(body.requestId, requestId);
      assert.equal(body.kind, 'order');
      assert.equal(body.replayed, false);
      assert.equal(body.order.status, 'running');
      assert.ok(typeof body.order.etaMs === 'number' && body.order.etaMs > 0, 'etaMs');

      const ticks = body.order.etaMs / tickMs;
      let prev: Vec2 = server.world.getAgent(DEV_AGENT)!.pos;
      for (let t = 1; t <= ticks; t++) {
        server.world.step();
        const now = server.world.getAgent(DEV_AGENT)!.pos;
        assert.ok(now.x !== prev.x || now.y !== prev.y, `position did not change on tick ${t}`);
        prev = now;
      }
      assert.deepEqual(prev, dest.pos);
      assert.equal(server.world.getAgent(DEV_AGENT)!.order?.status, 'done');
    } finally {
      await server.close();
    }
  });

  test('Given an unreachable destination, when I send move, then the request fails with 422 NO_PATH', async () => {
    const server = await startServer();
    try {
      const requestId = rid();
      const res = await call(server, 'POST', '/v1/action', { body: { requestId, type: 'move', to: { x: 10, y: 10 } } });
      assert.equal(res.status, 422);
      assertMatchesSpec('post', '/v1/action', 422, res.body);
      const body = res.body as ActionErr;
      assert.equal(body.error.code, 'NO_PATH');
      assert.equal(body.requestId, requestId);
    } finally {
      await server.close();
    }
  });
});

describe('POST /v1/action (sprint 1: move and stop for dev agents)', () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  after(() => server.close());

  const post = (body: unknown, token?: string | null) => call(server, 'POST', '/v1/action', { body, token });

  test('stop ends the running order', async () => {
    await post({ requestId: rid(), type: 'move', to: { poiId: 'coast_north' } });
    const res = await post({ requestId: rid(), type: 'stop' });
    assert.equal(res.status, 200);
    assertMatchesSpec('post', '/v1/action', 200, res.body);
    assert.equal((res.body as ActionOk).order.type, 'stop');
    assert.equal(server.world.getAgent(DEV_AGENT)!.order?.type, 'stop');
  });

  test('a missing or unknown token gets 401 UNAUTHORIZED', async () => {
    for (const token of [null, 'wa_live_not_a_real_token']) {
      const res = await post({ requestId: rid(), type: 'stop' }, token);
      assert.equal(res.status, 401);
      assertMatchesSpec('post', '/v1/action', 401, res.body);
      assert.equal((res.body as ActionErr).error.code, 'UNAUTHORIZED');
    }
  });

  test('a move without `to` gets 400 VALIDATION naming /to', async () => {
    const res = await post({ requestId: rid(), type: 'move', gait: 'run' });
    assert.equal(res.status, 400);
    assertMatchesSpec('post', '/v1/action', 400, res.body);
    const body = res.body as ActionErr;
    assert.equal(body.error.code, 'VALIDATION');
    assert.equal(body.error.details?.path, '/to');
  });

  test('an unknown action type gets 400 VALIDATION naming /type', async () => {
    const res = await post({ requestId: rid(), type: 'teleport' });
    assert.equal(res.status, 400);
    assertMatchesSpec('post', '/v1/action', 400, res.body);
    assert.equal((res.body as ActionErr).error.details?.path, '/type');
  });

  test('a valid action type from a later sprint is refused with 400 VALIDATION and does nothing', async () => {
    const before = server.world.hash();
    const res = await post({ requestId: rid(), type: 'talk', text: 'hello' });
    assert.equal(res.status, 400);
    assertMatchesSpec('post', '/v1/action', 400, res.body);
    assert.match((res.body as ActionErr).error.message, /not available/);
    assert.equal(server.world.hash(), before);
  });

  test('a missing requestId gets 400 VALIDATION naming /requestId', async () => {
    const res = await post({ type: 'stop' });
    assert.equal(res.status, 400);
    assert.equal((res.body as ActionErr).error.details?.path, '/requestId');
  });

  test('a coordinate off the 2,000 m map gets 400 VALIDATION', async () => {
    const res = await post({ requestId: rid(), type: 'move', to: { x: 2500, y: 10 } });
    assert.equal(res.status, 400);
    assertMatchesSpec('post', '/v1/action', 400, res.body);
  });

  test('malformed JSON gets 400 VALIDATION', async () => {
    const res = await call(server, 'POST', '/v1/action', { raw: '{"type": "move",' });
    assert.equal(res.status, 400);
    assertMatchesSpec('post', '/v1/action', 400, res.body);
  });

  test('an unknown place gets 404 NOT_FOUND', async () => {
    const res = await post({ requestId: rid(), type: 'move', to: { poiId: 'mon_atlantis' } });
    assert.equal(res.status, 404);
    assertMatchesSpec('post', '/v1/action', 404, res.body);
    assert.equal((res.body as ActionErr).error.code, 'NOT_FOUND');
  });
});
