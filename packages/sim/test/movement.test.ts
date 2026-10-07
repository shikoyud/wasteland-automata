import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '@wa/rules';
import { World } from '../src/world.ts';
import type { Vec2 } from '../src/types.ts';
import { mapFor } from './helpers.ts';

const SEED = 'w1-s1';
const runStepM = 6.5 / rules.world.tickHz;

function freshWorld(): World {
  const world = new World({ seed: SEED, rules, map: mapFor(SEED) });
  world.apply('ag_a', { type: 'spawn', name: 'Rook-9' });
  world.apply('ag_b', { type: 'spawn', name: 'Vex' });
  return world;
}

const posOf = (w: World, id: string): Vec2 => ({ ...w.getAgent(id)!.pos });
const monument = () => mapFor(SEED).pois.find((p) => p.kind === 'monument')!;
/** An ocean point: blocked, and far from any land. */
const OCEAN: Vec2 = { x: 10, y: 10 };

describe('move orders', () => {
  test('a run order reports etaMs and moves the body every tick until it arrives exactly on time', () => {
    const world = freshWorld();
    const target = monument();
    const r = world.apply('ag_a', { type: 'move', to: { poiId: target.id }, gait: 'run' });
    assert.ok(r.ok && 'order' in r, JSON.stringify(r));
    const { order } = r;
    assert.equal(order.type, 'move');
    assert.equal(order.status, 'running');
    assert.equal(order.targetId, target.id);
    assert.ok(order.etaMs !== null && order.etaMs > 0);
    const etaTicks = order.etaMs / (1000 / rules.world.tickHz);
    assert.ok(Number.isInteger(etaTicks));

    let prev = posOf(world, 'ag_a');
    for (let t = 1; t < etaTicks; t++) {
      world.step();
      const now = posOf(world, 'ag_a');
      const moved = Math.hypot(now.x - prev.x, now.y - prev.y);
      assert.ok(moved > 0, `no movement on tick ${t}`);
      assert.ok(moved <= runStepM + 1e-9, `moved ${moved} m in one tick`);
      assert.equal(world.getAgent('ag_a')!.order?.status, 'running');
      prev = now;
    }
    world.step();
    assert.deepEqual(posOf(world, 'ag_a'), target.pos);
    const done = world.getAgent('ag_a')!.order!;
    assert.equal(done.status, 'done');
    assert.equal(done.etaMs, 0);
    const events = world.eventsSince(0).filter((e) => e.type === 'order_done' && e.actorId === 'ag_a');
    assert.equal(events.length, 1);
    assert.equal(events[0]!.targetId, target.id);
  });

  test('walking takes 6.5/4 times as long as running over the same path', () => {
    const run = freshWorld().apply('ag_a', { type: 'move', to: { poiId: monument().id }, gait: 'run' });
    const walk = freshWorld().apply('ag_a', { type: 'move', to: { poiId: monument().id }, gait: 'walk' });
    assert.ok(run.ok && 'order' in run && walk.ok && 'order' in walk);
    const ratio = walk.order.etaMs! / run.order.etaMs!;
    assert.ok(Math.abs(ratio - 6.5 / 4) < 0.02, `ratio ${ratio}`);
  });

  test('the default gait is walk', () => {
    const a = freshWorld().apply('ag_a', { type: 'move', to: { poiId: monument().id } });
    const b = freshWorld().apply('ag_a', { type: 'move', to: { poiId: monument().id }, gait: 'walk' });
    assert.deepEqual(a, b);
  });

  test('an unreachable destination is refused with NO_PATH and the running order keeps going', () => {
    const world = freshWorld();
    const first = world.apply('ag_a', { type: 'move', to: { poiId: monument().id } });
    assert.ok(first.ok && 'order' in first);
    const r = world.apply('ag_a', { type: 'move', to: OCEAN, gait: 'run' });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.code === 'NO_PATH');
    assert.equal(world.getAgent('ag_a')!.order?.id, first.order.id);
    assert.equal(world.getAgent('ag_a')!.order?.status, 'running');
  });

  test('a new order replaces the running one', () => {
    const world = freshWorld();
    const first = world.apply('ag_a', { type: 'move', to: { poiId: monument().id } });
    const second = world.apply('ag_a', { type: 'move', to: { poiId: 'coast_north' } });
    assert.ok(first.ok && 'order' in first && second.ok && 'order' in second);
    assert.notEqual(second.order.id, first.order.id);
    assert.equal(world.getAgent('ag_a')!.order?.id, second.order.id);
  });

  test('stop ends movement and the body stays put', () => {
    const world = freshWorld();
    world.apply('ag_a', { type: 'move', to: { poiId: monument().id } });
    world.step();
    const r = world.apply('ag_a', { type: 'stop' });
    assert.ok(r.ok && 'order' in r);
    assert.equal(r.order.type, 'stop');
    assert.equal(r.order.status, 'done');
    const here = posOf(world, 'ag_a');
    for (let i = 0; i < 8; i++) world.step();
    assert.deepEqual(posOf(world, 'ag_a'), here);
  });

  test('moving to an entity follows it and ends next to it', () => {
    const world = freshWorld();
    world.apply('ag_b', { type: 'move', to: { poiId: monument().id }, gait: 'walk' });
    const r = world.apply('ag_a', { type: 'move', to: { entityId: 'ag_b' }, gait: 'run' });
    assert.ok(r.ok && 'order' in r);
    assert.equal(r.order.targetId, 'ag_b');
    for (let i = 0; i < 4 * 60 * 10 && world.getAgent('ag_a')!.order?.status === 'running'; i++) world.step();
    assert.equal(world.getAgent('ag_a')!.order?.status, 'done');
    const a = posOf(world, 'ag_a');
    const b = posOf(world, 'ag_b');
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= rules.movement.entityArriveWithinM + 1e-9);
  });

  test('an unknown place or entity is NOT_FOUND, and so are base and bed before you have them', () => {
    const world = freshWorld();
    for (const to of [{ poiId: 'mon_nowhere' }, { entityId: 'ag_ghost' }, { poiId: 'base' }, { poiId: 'bed' }]) {
      const r = world.apply('ag_a', { type: 'move', to });
      assert.ok(!r.ok && r.code === 'NOT_FOUND', JSON.stringify(to));
    }
  });

  test('a point off the map is refused with NO_PATH', () => {
    const r = freshWorld().apply('ag_a', { type: 'move', to: { x: 2500, y: 100 } });
    assert.ok(!r.ok && r.code === 'NO_PATH');
  });
});
