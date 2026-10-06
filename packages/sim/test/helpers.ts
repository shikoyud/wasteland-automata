import { rules } from '@wa/rules';
import { generateMap } from '../src/map/generate.ts';
import type { GameMap } from '../src/map/types.ts';
import { Rng } from '../src/rng.ts';
import type { LoggedCommand } from '../src/replay.ts';

const maps = new Map<string, GameMap>();

/** Maps take ~60 ms to generate; tests share one per seed. Maps are never mutated after generation. */
export function mapFor(seed: string): GameMap {
  let m = maps.get(seed);
  if (!m) {
    m = generateMap(seed, rules);
    maps.set(seed, m);
  }
  return m;
}

/**
 * A busy, reproducible action log: agents spawn, then move to random points (some unreachable),
 * to map places and to each other, switch gaits and stop.
 */
export function busyLog(seed: string, agents: number, ticks: number): LoggedCommand[] {
  const map = mapFor(seed);
  const rng = Rng.fromSeed(`log:${seed}`);
  const ids = Array.from({ length: agents }, (_, i) => `ag_${i.toString(36)}`);
  const log: LoggedCommand[] = ids.map((id, i) => ({ tick: Math.floor(i / 4), agentId: id, command: { type: 'spawn', name: `Bot-${i}` } }));
  const firstMoveTick = Math.ceil(agents / 4) + 1;
  for (let t = firstMoveTick; t < ticks; t++) {
    if (rng.next() > 0.3) continue;
    const agentId = rng.pick(ids);
    const roll = rng.next();
    const gait = rng.next() < 0.5 ? 'walk' : 'run';
    if (roll < 0.5) log.push({ tick: t, agentId, command: { type: 'move', to: { x: rng.range(0, 2000), y: rng.range(0, 2000) }, gait } });
    else if (roll < 0.7) log.push({ tick: t, agentId, command: { type: 'move', to: { poiId: rng.pick(map.pois).id }, gait } });
    else if (roll < 0.9) log.push({ tick: t, agentId, command: { type: 'move', to: { entityId: rng.pick(ids) }, gait } });
    else log.push({ tick: t, agentId, command: { type: 'stop' } });
  }
  return log;
}
