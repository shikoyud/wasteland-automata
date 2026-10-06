import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run, tail } from './helpers.ts';

describe('WA-101 Repo skeleton', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-clone-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('Given a fresh clone, when I run pnpm install and pnpm build, then every package builds with zero errors', { timeout: 20 * 60_000 }, () => {
    const repo = join(dir, 'repo');
    const clone = run('git', ['clone', '--quiet', root, repo], dir);
    assert.equal(clone.status, 0, tail(clone));

    const install = run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], repo);
    assert.equal(install.status, 0, tail(install));

    const build = run('pnpm', ['build'], repo);
    assert.equal(build.status, 0, tail(build));

    // Every package produced its build output.
    for (const out of [
      'packages/rules/dist/src/index.js',
      'packages/sim/dist/index.js',
      'packages/client/dist/agent.js',
      'apps/world-server/dist/main.js',
      'apps/chain-watcher/dist/main.js',
      'apps/dashboard/.next/BUILD_ID',
      'contracts/out/WastelandCheckout.sol/WastelandCheckout.json',
    ]) {
      assert.ok(existsSync(join(repo, out)), `missing build output ${out}`);
    }
  });
});
