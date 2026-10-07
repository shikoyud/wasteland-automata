import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('chain watcher stub', () => {
  test('it starts, says payments arrive in sprint 8 and exits cleanly', () => {
    const r = spawnSync(process.execPath, [main], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /WA-804/);
  });
});
