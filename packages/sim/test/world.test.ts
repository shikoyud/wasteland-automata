import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '@wa/rules';
import { World } from '../src/world.ts';
import { replay } from '../src/replay.ts';
import { busyLog, mapFor } from './helpers.ts';

describe('WA-201 Deterministic tick loop', () => {
  test('Given the same seed and action log, when the simulation runs twice, then the state hash after every tick is identical', () => {
    const seed = 'w1-s1';
    const log = busyLog(seed, 40, 1200);
    const first = replay({ seed, rules, map: mapFor(seed) }, log, 1200);
    // The second run generates its own map, so nothing is shared between the runs.
    const second = replay({ seed, rules }, log, 1200);
    assert.equal(first.length, 1200);
    assert.deepEqual(second, first);
  });

  test('Given 500 idle agents, when the loop runs for 10 minutes, then tick p99 stays under 50 ms', () => {
    const world = new World({ seed: 'w1-s1', rules, map: mapFor('w1-s1') });
    for (let i = 0; i < 500; i++) world.apply(`ag_${i}`, { type: 'spawn', name: `Idle-${i}` });
    const ticks = 10 * 60 * rules.world.tickHz;
    const durations = new Float64Array(ticks);
    for (let t = 0; t < ticks; t++) {
      const t0 = performance.now();
      world.step();
      durations[t] = performance.now() - t0;
    }
    durations.sort();
    const p99 = durations[Math.floor(ticks * 0.99)] as number;
    assert.equal(world.tick, ticks);
    assert.ok(p99 < 50, `tick p99 was ${p99.toFixed(3)} ms`);
  });
});

describe('simulation determinism', () => {
  test('a different seed gives different hashes', () => {
    const log = busyLog('w1-s1', 10, 100);
    assert.notDeepEqual(replay({ seed: 'w1-s2', rules, map: mapFor('w1-s2') }, log, 100), replay({ seed: 'w1-s1', rules, map: mapFor('w1-s1') }, log, 100));
  });

  test('changing one logged action leaves earlier hashes alone and changes the hash at its tick', () => {
    const seed = 'w1-s1';
    const log = busyLog(seed, 10, 300);
    const changed = log.map((e) => ({ ...e }));
    // A move to a map place always succeeds, so changing its gait must change the state.
    const idx = changed.findIndex((e) => e.command.type === 'move' && 'poiId' in e.command.to);
    const original = changed[idx]!;
    assert.ok(original.command.type === 'move');
    changed[idx] = { ...original, command: { ...original.command, gait: original.command.gait === 'run' ? 'walk' : 'run' } };
    const a = replay({ seed, rules, map: mapFor(seed) }, log, 300);
    const b = replay({ seed, rules, map: mapFor(seed) }, changed, 300);
    assert.deepEqual(b.slice(0, original.tick), a.slice(0, original.tick));
    assert.notEqual(b[original.tick], a[original.tick]);
  });

  test('the tick counter advances by one per step and the hash covers it', () => {
    const world = new World({ seed: 'w1-s1', rules, map: mapFor('w1-s1') });
    const h0 = world.hash();
    world.step();
    assert.equal(world.tick, 1);
    assert.notEqual(world.hash(), h0);
  });

  test('a spawned agent stands on walkable ground at one of the spawn coasts', () => {
    const map = mapFor('w1-s1');
    const world = new World({ seed: 'w1-s1', rules, map });
    for (let i = 0; i < 20; i++) {
      const r = world.apply(`ag_${i}`, { type: 'spawn', name: `S-${i}` });
      assert.ok(r.ok);
      const a = world.getAgent(`ag_${i}`)!;
      assert.ok(map.nav.isWalkable(a.pos.x, a.pos.y));
      const coast = map.pois.filter((p) => p.kind === 'coast').some((c) => Math.hypot(c.pos.x - a.pos.x, c.pos.y - a.pos.y) <= c.radiusM);
      assert.ok(coast, `agent ${i} spawned away from every coast`);
    }
  });

  test('spawning the same agent twice is a programming error', () => {
    const world = new World({ seed: 'w1-s1', rules, map: mapFor('w1-s1') });
    world.apply('ag_1', { type: 'spawn', name: 'One' });
    assert.throws(() => world.apply('ag_1', { type: 'spawn', name: 'One' }), /already/);
  });
});
