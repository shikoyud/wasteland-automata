import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const agent = fileURLToPath(new URL('../agent.ts', import.meta.url));

describe('reference client', () => {
  test('it refuses to start without WA_TOKEN and says which variable is missing', () => {
    const env = { ...process.env };
    delete env.WA_TOKEN;
    const r = spawnSync(process.execPath, [agent], { env, encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Missing environment variable WA_TOKEN/);
  });
});
