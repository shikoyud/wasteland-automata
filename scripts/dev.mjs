#!/usr/bin/env node
// pnpm dev: start Postgres and Anvil in Docker, wait until both are healthy, then run the world server
// with a seeded world on http://localhost:8787 (restarting on source changes). Ctrl-C stops the server;
// the containers keep running for a fast restart (`docker compose down` stops them).
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const up = spawnSync('docker', ['compose', 'up', '--detach', '--wait', 'postgres', 'anvil'], { cwd: root, stdio: 'inherit' });
if (up.error || up.status !== 0) {
  process.stderr.write(
    '\nCould not start Postgres and Anvil. Is Docker running? (Docker Desktop on Windows and macOS.)\n' +
      'Check with: docker compose ps\n',
  );
  process.exit(1);
}

const env = {
  WA_ENV: 'local',
  DATABASE_URL: `postgres://wa:wa@localhost:${process.env.PG_PORT ?? 5432}/wa`,
  CHAIN_RPC_URL: `http://localhost:${process.env.ANVIL_PORT ?? 8545}`,
  ...process.env,
};
const server = spawn(process.execPath, ['--conditions=source', '--watch', 'apps/world-server/src/main.ts'], { cwd: root, stdio: 'inherit', env });

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code, signal) => {
  process.stdout.write('\nWorld server stopped. Postgres and Anvil are still running; `docker compose down` stops them.\n');
  process.exit(stopping ? 0 : (code ?? (signal ? 1 : 0)));
});
