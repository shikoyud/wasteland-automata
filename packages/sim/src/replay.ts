import { World, type Command, type WorldOptions } from './world.ts';

/** One command as recorded by the server: applied after tick `tick` completed, before the next step. */
export interface LoggedCommand {
  tick: number;
  agentId: string;
  command: Command;
}

/**
 * Runs a fresh world for `ticks` ticks, applying each logged command at its tick, and returns the
 * state hash after every tick. Two runs with the same seed, rules and log must return equal arrays.
 */
export function replay(opts: WorldOptions, log: readonly LoggedCommand[], ticks: number): string[] {
  const world = new World(opts);
  const ordered = log.map((entry, i) => ({ entry, i })).sort((a, b) => a.entry.tick - b.entry.tick || a.i - b.i);
  const hashes: string[] = [];
  let k = 0;
  for (let t = 0; t < ticks; t++) {
    while (k < ordered.length && (ordered[k]!.entry.tick as number) <= t) {
      const { agentId, command } = ordered[k]!.entry;
      world.apply(agentId, command);
      k++;
    }
    world.step();
    hashes.push(world.hash());
  }
  return hashes;
}
