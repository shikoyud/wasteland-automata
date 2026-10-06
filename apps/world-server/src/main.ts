/**
 * World server entry point: one process, one world. Generates the season map from the seed,
 * spawns dev agents outside production, runs the 4 Hz loop and serves the HTTP API.
 */
import type { AddressInfo } from 'node:net';
import { rules } from '@wa/rules';
import { World } from '@wa/sim';
import { createApp } from './app.ts';
import { devAgents, loadConfig } from './config.ts';
import { jsonLogger } from './log.ts';
import { TickLoop } from './loop.ts';
import { Spec } from './spec.ts';
import { TokenTable } from './tokens.ts';

const log = jsonLogger();

function main(): void {
  const config = loadConfig(process.env);
  const t0 = performance.now();
  const world = new World({ seed: config.worldSeed, rules });
  const tokens = new TokenTable();
  const dev = devAgents(config.devAgents);
  for (const a of dev) {
    world.apply(a.id, { type: 'spawn', name: a.name });
    tokens.add(a.token, a.id);
  }
  const spec = Spec.load();
  const { server } = createApp({ world, rules, spec, worldId: config.worldId, tokens, log });
  const loop = new TickLoop(() => world.step(), 1000 / rules.world.tickHz);

  server.listen(config.port, config.host, () => {
    loop.start();
    const { port } = server.address() as AddressInfo;
    log.info('listening', {
      env: config.env,
      worldId: config.worldId,
      seed: config.worldSeed,
      mapHash: world.map.hash,
      rulesVersion: rules.rulesVersion,
      port,
      bootMs: Math.round(performance.now() - t0),
      devTokens: dev.map((a) => `${a.name}=${a.token}`),
    });
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    loop.stop();
    log.info('stopping', { signal, tick: world.tick, tickStats: loop.stats() });
    // Snapshots on SIGTERM arrive with WA-208; for now the world simply stops.
    server.close(() => {
      log.info('stopped', { tick: world.tick });
      process.exit(0);
    });
    server.closeAllConnections();
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

try {
  main();
} catch (err) {
  log.error('failed to start', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}
