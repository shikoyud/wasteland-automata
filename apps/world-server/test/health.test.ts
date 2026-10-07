import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '@wa/rules';
import { assertMatchesSpec, call, startServer } from './helpers.ts';

describe('health and routing', () => {
  test('GET /healthz reports the world id, its tick and the rules version', async () => {
    const server = await startServer();
    try {
      server.world.step();
      server.world.step();
      const res = await call(server, 'GET', '/healthz', { token: null });
      assert.equal(res.status, 200);
      assertMatchesSpec('get', '/healthz', 200, res.body);
      assert.deepEqual(res.body, { ok: true, worldId: 'w1', tick: 2, rulesVersion: rules.rulesVersion });
    } finally {
      await server.close();
    }
  });

  test('an unknown path gets 404 NOT_FOUND in the standard error shape', async () => {
    const server = await startServer();
    try {
      const res = await call(server, 'GET', '/v1/nowhere', { token: null });
      assert.equal(res.status, 404);
      assert.deepEqual(Object.keys(res.body as object).sort(), ['error', 'ok']);
      assert.equal((res.body as { error: { code: string } }).error.code, 'NOT_FOUND');
    } finally {
      await server.close();
    }
  });
});
