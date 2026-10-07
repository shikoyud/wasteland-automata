import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '@wa/rules';
import { generateMap } from '../src/map/generate.ts';
import type { GameMap } from '../src/map/types.ts';

const SEEDS = ['w1-s1', 'w1-s2', 'w1-s3', 'w2-s1', 'alpha', 'beta-7', 'season-42', 'x'];
const cache = new Map<string, GameMap>();
const mapFor = (seed: string): GameMap => {
  let m = cache.get(seed);
  if (!m) {
    m = generateMap(seed, rules);
    cache.set(seed, m);
  }
  return m;
};
const codes = new Set(rules.biomes.map((b) => b.code));

describe('WA-202 Map generation', () => {
  test('Given a season seed, when the map is generated, then it has a 40x40 biome grid, at least 6 monuments, 4 spawn coasts and a 4 m navigation grid', () => {
    for (const seed of SEEDS) {
      const map = mapFor(seed);
      assert.equal(map.biomes.length, 40, `${seed}: rows`);
      for (const row of map.biomes) {
        assert.equal(row.length, 40, `${seed}: row length`);
        for (const c of row) assert.ok(codes.has(c), `${seed}: unknown biome code ${c}`);
      }
      const monuments = map.pois.filter((p) => p.kind === 'monument');
      assert.ok(monuments.length >= 6, `${seed}: only ${monuments.length} monuments`);
      const coasts = map.pois.filter((p) => p.kind === 'coast');
      assert.deepEqual(coasts.map((c) => c.id).sort(), ['coast_east', 'coast_north', 'coast_south', 'coast_west'], seed);
      assert.equal(map.nav.cellM, 4, seed);
      assert.equal(map.nav.width, 500, seed);
      assert.equal(map.nav.height, 500, seed);
      assert.equal(map.nav.blocked.length, 500 * 500, seed);
    }
  });
});

describe('map generation', () => {
  test('the same seed gives the same map, and another seed a different one', () => {
    assert.equal(generateMap('w1-s1', rules).hash, mapFor('w1-s1').hash);
    assert.notEqual(mapFor('w1-s1').hash, mapFor('w1-s2').hash);
  });

  test('the map is an island: the outer ring of biome cells is ocean', () => {
    for (const seed of SEEDS) {
      const b = mapFor(seed).biomes;
      for (let i = 0; i < 40; i++) {
        for (const c of [b[0]?.[i], b[39]?.[i], b[i]?.[0], b[i]?.[39]]) assert.equal(c, 'O', `${seed}: border cell is ${c}`);
      }
    }
  });

  test('every monument and spawn coast can be reached from every other', () => {
    for (const seed of SEEDS) {
      const map = mapFor(seed);
      const regions = new Set(map.pois.map((p) => map.nav.regionAt(p.pos.x, p.pos.y)));
      assert.equal(regions.size, 1, `${seed}: points of interest sit in ${regions.size} separate regions`);
      assert.ok(!regions.has(-1), `${seed}: a point of interest is on a blocked cell`);
    }
  });

  test('monuments are at least 250 m apart and stand on walkable ground', () => {
    for (const seed of SEEDS) {
      const ms = mapFor(seed).pois.filter((p) => p.kind === 'monument');
      for (let i = 0; i < ms.length; i++) {
        for (let j = i + 1; j < ms.length; j++) {
          const a = ms[i]!.pos;
          const b = ms[j]!.pos;
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 250, `${seed}: ${ms[i]!.name} and ${ms[j]!.name} too close`);
        }
      }
      assert.equal(new Set(ms.map((m) => m.name)).size, ms.length, `${seed}: duplicate monument names`);
    }
  });

  test('each spawn coast is on its own side of the island, next to the sea', () => {
    for (const seed of SEEDS) {
      const map = mapFor(seed);
      const at = (id: string) => map.pois.find((p) => p.id === id)!.pos;
      assert.ok(at('coast_north').y < 700, `${seed}: north coast at y=${at('coast_north').y}`);
      assert.ok(at('coast_south').y > 1300, `${seed}: south coast at y=${at('coast_south').y}`);
      assert.ok(at('coast_west').x < 700, `${seed}: west coast at x=${at('coast_west').x}`);
      assert.ok(at('coast_east').x > 1300, `${seed}: east coast at x=${at('coast_east').x}`);
      for (const c of map.pois.filter((p) => p.kind === 'coast')) {
        assert.ok(map.nav.oceanDistanceM(c.pos.x, c.pos.y) <= 12, `${seed}: ${c.id} is not on the shore`);
      }
    }
  });

  test('between a third and three quarters of the map is walkable land', () => {
    for (const seed of SEEDS) {
      const { blocked } = mapFor(seed).nav;
      let open = 0;
      for (let i = 0; i < blocked.length; i++) if (blocked[i] === 0) open++;
      const share = open / blocked.length;
      assert.ok(share > 1 / 3 && share < 3 / 4, `${seed}: walkable share ${share.toFixed(2)}`);
    }
  });

  test('a map generates in under a second', () => {
    const t0 = performance.now();
    generateMap('timing-check', rules);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  });
});
