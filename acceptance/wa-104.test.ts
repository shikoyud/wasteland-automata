import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dockerAvailable, root, run, tail } from './helpers.ts';

const BASE = 'http://localhost:8787';

async function waitForHealth(deadline: number): Promise<{ ok: boolean; worldId: string; tick: number }> {
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return (await res.json()) as { ok: boolean; worldId: string; tick: number };
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`world server did not answer on ${BASE}/healthz: ${last}`);
}

// Locally without Docker this is skipped; in CI (CI=true) a missing Docker is a failure.
const skip = !process.env.CI && !dockerAvailable() ? 'Docker is not available here' : false;

describe('WA-104 Local stack with Postgres and Anvil', () => {
  after(() => {
    run('docker', ['compose', 'down', '--volumes'], root, 120_000);
  });

  test('Given Docker installed, when I run pnpm dev, then the world server, Postgres and Anvil start and a seeded world answers on localhost:8787', { skip, timeout: 10 * 60_000 }, async () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const windows = process.platform === 'win32';
    // Its own process group, so Ctrl-C reaches pnpm, the dev script and the server together.
    const dev = spawn('pnpm', ['dev'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], shell: windows, detached: !windows });
    const signal = (sig: NodeJS.Signals) => {
      if (!windows && dev.pid) process.kill(-dev.pid, sig);
      else dev.kill(sig);
    };
    let out = '';
    dev.stdout.on('data', (d: Buffer) => (out += d.toString()));
    dev.stderr.on('data', (d: Buffer) => (out += d.toString()));
    try {
      const health = await waitForHealth(Date.now() + 8 * 60_000).catch((e: Error) => {
        throw new Error(`${e.message}\n--- pnpm dev output ---\n${out.slice(-4000)}`);
      });
      assert.equal(health.ok, true);
      assert.equal(health.worldId, 'w1');
      assert.match(out, /"msg":"listening".*"seed":"w1-local"/, 'the world is seeded from the local seed');
      assert.match(out, /wa_dev_1/, 'dev agents are seeded');
      await new Promise((r) => setTimeout(r, 1000));
      const later = await waitForHealth(Date.now() + 10_000);
      assert.ok(later.tick > health.tick, 'the world is ticking');

      const pg = run('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'wa', '-d', 'wa'], root, 60_000);
      assert.equal(pg.status, 0, `Postgres is not ready:\n${tail(pg)}`);

      const rpc = await fetch('http://localhost:8545', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      assert.deepEqual(((await rpc.json()) as { result: string }).result, '0x7a69', 'Anvil answers as chain 31337');
    } finally {
      signal('SIGINT');
      await Promise.race([once(dev, 'exit'), new Promise((r) => setTimeout(r, 15_000))]);
      if (dev.exitCode === null) signal('SIGKILL');
    }
  });
});
