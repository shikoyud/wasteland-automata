import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));

/** Runs a command to completion; on Windows, pnpm and docker are .cmd shims that need a shell. */
export function run(cmd: string, args: string[], cwd: string, timeoutMs = 15 * 60_000): SpawnSyncReturns<string> {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env, shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
}

export const tail = (r: SpawnSyncReturns<string>, lines = 40): string => `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split('\n').slice(-lines).join('\n');

export function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 20_000, shell: process.platform === 'win32' });
  return !r.error && r.status === 0;
}
