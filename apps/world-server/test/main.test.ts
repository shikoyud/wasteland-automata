import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const mainTs = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('world server process', () => {
  test('it boots a seeded world, ticks at 4 Hz, moves a dev agent and shuts down cleanly on SIGTERM', async () => {
    const child = spawn(process.execPath, ['--conditions=source', mainTs], {
      env: { ...process.env, WA_ENV: 'test', PORT: '0', HOST: '127.0.0.1', WORLD_SEED: 'boot-test', DEV_AGENTS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no "listening" line within 20 s:\n${out}`)), 20_000);
        child.stdout.on('data', () => {
          const m = /"msg":"listening".*"port":(\d+)/.exec(out);
          if (m) {
            clearTimeout(timer);
            resolve(Number(m[1]));
          }
        });
      });
      const base = `http://127.0.0.1:${port}`;
      const h1 = (await (await fetch(`${base}/healthz`)).json()) as { tick: number; worldId: string };
      assert.equal(h1.worldId, 'w1');
      await new Promise((r) => setTimeout(r, 1100));
      const h2 = (await (await fetch(`${base}/healthz`)).json()) as { tick: number };
      const advanced = h2.tick - h1.tick;
      assert.ok(advanced >= 3 && advanced <= 6, `expected about 4 ticks in 1.1 s, got ${advanced}`);

      const res = await fetch(`${base}/v1/action`, {
        method: 'POST',
        headers: { authorization: 'Bearer wa_dev_1', 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'r-boot-000001', type: 'move', to: { poiId: 'coast_north' }, gait: 'run' }),
      });
      assert.equal(res.status, 200, await res.clone().text());

      child.kill('SIGTERM');
      const [code] = (await once(child, 'exit')) as [number | null];
      assert.equal(code, 0, out);
      assert.match(out, /"msg":"stopped"/);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
});
