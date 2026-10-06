import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/index.ts';

const minutes = (hhmm: string): number => {
  const m = /^(\d\d):(\d\d)$/.exec(hhmm);
  assert.ok(m, `not HH:MM: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

describe('rules.json invariants', () => {
  test('rulesVersion looks like YYYY.MM.N', () => {
    assert.match(rules.rulesVersion, /^\d{4}\.\d{1,2}\.\d+$/);
  });

  test('the map is a 40x40 biome grid of 50 m cells over a 500x500 grid of 4 m nav cells', () => {
    assert.equal(rules.world.sizeM / rules.world.biomeCellM, 40);
    assert.equal(rules.world.sizeM / rules.world.navCellM, 500);
  });

  test('biome codes are unique single capital letters, and water is not walkable', () => {
    const codes = rules.biomes.map((b) => b.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const b of rules.biomes) assert.match(b.code, /^[A-Z]$/);
    for (const id of ['ocean', 'lake']) assert.equal(rules.biomes.find((b) => b.id === id)?.walkable, false);
  });

  test('there are enough monument names and exactly one spawn coast per side', () => {
    assert.ok(rules.map.monumentNames.length >= rules.map.targetMonuments);
    assert.ok(rules.map.targetMonuments >= rules.map.minMonuments);
    assert.deepEqual(rules.map.spawnCoasts.map((c) => c.side).sort(), ['east', 'north', 'south', 'west']);
  });

  test('walk is 4 m/s and run is 6.5 m/s, as the API documents', () => {
    const speed = (id: string) => rules.movement.gaits.find((g) => g.id === id)?.speedMps;
    assert.equal(speed('walk'), 4);
    assert.equal(speed('run'), 6.5);
    assert.ok(rules.movement.gaits.some((g) => g.id === rules.movement.defaultGait));
  });

  test('raid windows are ordered, two hours long and do not overlap', () => {
    let last = -1;
    for (const w of rules.raids.windowsUtc) {
      const open = minutes(w.opens);
      const close = minutes(w.closes);
      assert.ok(open > last, `windows overlap or are out of order at ${w.opens}`);
      assert.equal(close - open, 120);
      last = close;
    }
  });

  test('the default stance is within the allowed retreat range', () => {
    const { default: d, retreatAtHpMin, retreatAtHpMax } = rules.stance;
    assert.ok(d.retreatAtHp >= retreatAtHpMin && d.retreatAtHp <= retreatAtHpMax);
    assert.ok(['flee', 'hold', 'fight_back'].includes(d.combatResponse));
  });

  test('action types are disjoint across orders, background and meta', () => {
    const all = [...rules.orders.orderTypes, ...rules.orders.backgroundTypes, ...rules.orders.metaTypes];
    assert.equal(new Set(all).size, all.length);
  });
});
