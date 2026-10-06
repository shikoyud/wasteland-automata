import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '@wa/rules';
import { NavGrid } from '../src/nav/grid.ts';
import { findPath, lineOfSight } from '../src/nav/path.ts';
import { generateMap } from '../src/map/generate.ts';
import { Rng } from '../src/rng.ts';
import type { Vec2 } from '../src/types.ts';

const cell = (cx: number, cy: number): Vec2 => ({ x: cx * 4 + 2, y: cy * 4 + 2 });

function assertWalkablePath(grid: NavGrid, points: readonly Vec2[]): void {
  for (const p of points) assert.ok(grid.isWalkable(p.x, p.y), `waypoint (${p.x}, ${p.y}) is blocked`);
  for (let i = 1; i < points.length; i++) {
    assert.ok(lineOfSight(grid, points[i - 1]!, points[i]!), `segment ${i} crosses a blocked cell`);
  }
}

describe('A* on the nav grid', () => {
  test('an open straight line becomes a single segment', () => {
    const grid = NavGrid.fromAscii(Array.from({ length: 10 }, () => '..........'));
    const r = findPath(grid, { x: 2, y: 2 }, { x: 37, y: 30 });
    assert.ok(r.ok);
    assert.deepEqual(r.points, [{ x: 2, y: 2 }, { x: 37, y: 30 }]);
    assert.ok(Math.abs(r.lengthM - Math.sqrt(35 * 35 + 28 * 28)) < 1e-9);
  });

  test('a wall is walked around through its gap', () => {
    const grid = NavGrid.fromAscii(['..........', '..........', '#########.', '..........', '..........']);
    const from = cell(0, 0);
    const to = cell(0, 4);
    const r = findPath(grid, from, to);
    assert.ok(r.ok);
    assertWalkablePath(grid, r.points);
    assert.ok(r.points.some((p) => p.x > 32), 'the path must pass through the gap on the right');
    // Between the any-angle optimum through the gap (73.05 m) and the 8-way grid path (83.3 m).
    assert.ok(r.lengthM > 73 && r.lengthM < 83.3, `length ${r.lengthM}`);
  });

  test('corners are never cut diagonally', () => {
    const grid = NavGrid.fromAscii(['.#', '#.']);
    const r = findPath(grid, cell(0, 0), cell(1, 1));
    assert.equal(r.ok, false);
  });

  test('an enclosed area is unreachable', () => {
    const grid = NavGrid.fromAscii(['.......', '.#####.', '.#...#.', '.#####.', '.......']);
    const r = findPath(grid, cell(0, 0), cell(3, 2));
    assert.deepEqual(r, { ok: false, reason: 'unreachable' });
  });

  test('a destination inside a thin wall snaps to the nearest open cell', () => {
    const grid = NavGrid.fromAscii(['.....', '.....', '#####', '.....']);
    const r = findPath(grid, cell(0, 0), cell(2, 2));
    assert.ok(r.ok);
    const end = r.points[r.points.length - 1]!;
    assert.ok(grid.isWalkable(end.x, end.y));
    assert.ok(Math.abs(end.y - cell(2, 2).y) <= 8);
  });

  test('a destination deep inside blocked ground is refused', () => {
    const rows = ['.........', ...Array.from({ length: 8 }, () => '#########')];
    const grid = NavGrid.fromAscii(rows);
    assert.deepEqual(findPath(grid, cell(0, 0), cell(4, 7)), { ok: false, reason: 'blocked_destination' });
  });

  test('a destination off the map is refused', () => {
    const grid = NavGrid.fromAscii(['...', '...']);
    assert.deepEqual(findPath(grid, cell(0, 0), { x: 500, y: 2 }), { ok: false, reason: 'out_of_bounds' });
  });

  test('the same request gives the same path', () => {
    const map = generateMap('w1-s1', rules);
    const a = map.pois.find((p) => p.id === 'coast_west')!.pos;
    const b = map.pois.find((p) => p.id === 'coast_east')!.pos;
    assert.deepEqual(findPath(map.nav, a, b), findPath(map.nav, a, b));
  });

  test('paths across a generated map stay on walkable ground, and p99 search time is under 50 ms', () => {
    const map = generateMap('w1-s1', rules);
    const main = map.nav.largestRegion();
    const rng = Rng.fromSeed('path-bench');
    const randomPoint = (): Vec2 => {
      for (;;) {
        const p = { x: rng.range(0, 2000), y: rng.range(0, 2000) };
        if (map.nav.regionAt(p.x, p.y) === main) return p;
      }
    };
    const times: number[] = [];
    for (let k = 0; k < 150; k++) {
      const from = randomPoint();
      const to = randomPoint();
      const t0 = performance.now();
      const r = findPath(map.nav, from, to);
      times.push(performance.now() - t0);
      assert.ok(r.ok, `no path between two points of the main region (${k})`);
      assertWalkablePath(map.nav, r.points);
      const straight = Math.sqrt((from.x - to.x) ** 2 + (from.y - to.y) ** 2);
      assert.ok(r.lengthM >= straight - 1e-6);
    }
    times.sort((a, b) => a - b);
    const p99 = times[Math.floor(times.length * 0.99)]!;
    assert.ok(p99 < 50, `p99 ${p99.toFixed(1)} ms`);
  });
});
