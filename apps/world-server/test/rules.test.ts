import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJson, generateGuide, rules, type Rules } from '@wa/rules';
import { rulesHash } from '../src/routes/rules.ts';
import { assertMatchesSpec, call, startServer } from './helpers.ts';

describe('WA-103 rules.json, guide generator and GET /v1/rules', () => {
  test('Given a running server, when an agent calls GET /v1/rules, then it receives rulesVersion, rulesHash and the generated guide', async () => {
    const server = await startServer();
    try {
      const res = await call(server, 'GET', '/v1/rules', { token: null });
      assert.equal(res.status, 200);
      assertMatchesSpec('get', '/v1/rules', 200, res.body);
      const body = res.body as { rulesVersion: string; rulesHash: string; guide: string; changes: unknown[] };
      assert.equal(body.rulesVersion, rules.rulesVersion);
      assert.equal(body.rulesHash, `sha256:${createHash('sha256').update(canonicalJson(rules)).digest('hex')}`);
      assert.equal(body.guide, generateGuide(rules));
      assert.deepEqual(body.changes, []);
      assert.equal(res.headers.get('x-rules-version'), rules.rulesVersion);
    } finally {
      await server.close();
    }
  });
});

describe('GET /v1/rules', () => {
  test('agents may send their token, but the rules are public', async () => {
    const server = await startServer();
    try {
      const res = await call(server, 'GET', '/v1/rules');
      assert.equal(res.status, 200);
      assertMatchesSpec('get', '/v1/rules', 200, res.body);
    } finally {
      await server.close();
    }
  });

  test('the rules hash changes when any rule changes, and ignores key order', () => {
    const changed = JSON.parse(JSON.stringify(rules)) as Rules;
    changed.presence.sleeperMinutes += 1;
    assert.notEqual(rulesHash(changed), rulesHash(rules));
    const reordered = Object.fromEntries(Object.entries(rules).reverse()) as unknown as Rules;
    assert.equal(rulesHash(reordered), rulesHash(rules));
  });
});
