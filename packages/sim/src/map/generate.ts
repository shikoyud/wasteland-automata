/**
 * Season map generation. Pure and deterministic: the same seed and rules give the same map.
 *
 * Shape: a squarish island (noise-perturbed falloff) with a 40 m ocean margin. Elevation is fractal
 * value noise; high ground becomes mountain, and peaks and rock outcrops block movement. Inland lakes
 * come from a separate noise field. Biomes (50 m cells) follow water share, elevation, a north-cold
 * temperature gradient and moisture. Monuments go on flat inland ground in the main walkable region;
 * one spawn coast is picked on each side of the island. If a seed's first layout misses a constraint,
 * the next attempt uses a derived seed, so every seed still maps to exactly one map.
 */
import type { Rules } from '@wa/rules';
import { Hasher } from '../hash.ts';
import { NavGrid } from '../nav/grid.ts';
import { Rng } from '../rng.ts';
import { ValueNoise } from './noise.ts';
import type { GameMap, Poi } from './types.ts';

const MAX_ATTEMPTS = 25;
const OCEAN_MARGIN_M = 40;
const SEA_LEVEL = 0.25;
const MOUNTAIN_LEVEL = 0.66;
const PEAK_LEVEL = 0.72;
const LAKE_LEVEL = 0.74;
const MIN_MAIN_REGION_SHARE = 0.3;
const MONUMENT_RADIUS_M = 40;
const MONUMENT_SPACING_M = [320, 250] as const;
const MONUMENT_MIN_OCEAN_DIST_M = 120;
const COAST_RADIUS_M = 40;
const COAST_MAX_OCEAN_DIST_CELLS = 2;
const COAST_MIN_SPACING_M = 500;

const sq = (v: number): number => v * v;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

export function generateMap(seed: string, rules: Rules): GameMap {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = tryGenerate(seed, attempt, rules);
    if (map) return map;
  }
  throw new Error(`No valid map for seed "${seed}" after ${MAX_ATTEMPTS} attempts`);
}

function tryGenerate(seed: string, attempt: number, rules: Rules): GameMap | null {
  const size = rules.world.sizeM;
  const cellM = rules.world.navCellM;
  const n = size / cellM;
  const half = size / 2;
  const rng = Rng.fromSeed(attempt === 0 ? `map:${seed}` : `map:${seed}#${attempt}`);
  const elevation = new ValueNoise(rng);
  const shape = new ValueNoise(rng);
  const lakes = new ValueNoise(rng);
  const rock = new ValueNoise(rng);
  const moisture = new ValueNoise(rng);
  const warmth = new ValueNoise(rng);

  const height = new Float32Array(n * n);
  const water = new Uint8Array(n * n);
  const blocked = new Uint8Array(n * n);

  for (let cy = 0; cy < n; cy++) {
    const y = (cy + 0.5) * cellM;
    for (let cx = 0; cx < n; cx++) {
      const x = (cx + 0.5) * cellM;
      const i = cy * n + cx;
      const dx = Math.abs(x - half) / half;
      const dy = Math.abs(y - half) / half;
      const d = 0.5 * Math.max(dx, dy) + 0.5 * Math.sqrt(dx * dx + dy * dy);
      const bent = d + (shape.fbm(x, y, 1 / 600, 3) - 0.5) * 0.3;
      const h = elevation.fbm(x, y, 1 / 420, 5) * (1 - smoothstep(0.6, 1.0, bent));
      height[i] = h;
      const edge = Math.min(x, y, size - x, size - y);
      const isLake = h > SEA_LEVEL + 0.05 && lakes.fbm(x, y, 1 / 300, 3) > LAKE_LEVEL;
      if (edge < OCEAN_MARGIN_M || h < SEA_LEVEL || isLake) water[i] = 1;
      const isPeak = h > PEAK_LEVEL || (h > MOUNTAIN_LEVEL && rock.fbm(x, y, 1 / 40, 2) > 0.64);
      if (water[i] === 1 || isPeak) blocked[i] = 1;
    }
  }

  // Ocean = water connected to the map edge; other water is lake.
  const ocean = floodFromEdge(water, n);
  const nav = new NavGrid(n, n, cellM, blocked);
  nav.computeOceanDistance(ocean);

  const biomes = buildBiomes(rules, n, cellM, height, water, ocean, moisture, warmth);

  let main = nav.largestRegion();
  if ((nav.regionSizes[main] ?? 0) < MIN_MAIN_REGION_SHARE * n * n) return null;

  const monuments = placeMonuments(rules, rng, nav, height, water, main);
  if (monuments.length < rules.map.minMonuments) return null;
  // Monument grounds are cleared of rock so their whole footprint is walkable.
  for (const m of monuments) clearFootprint(nav, water, m.pos.x, m.pos.y, m.radiusM);
  nav.labelRegions();
  main = nav.largestRegion();

  const coasts = placeCoasts(rules, nav, main);
  if (!coasts) return null;

  const pois: Poi[] = [...monuments, ...coasts];
  if (pois.some((p) => nav.regionAt(p.pos.x, p.pos.y) !== main)) return null;

  const hash = new Hasher().str(seed).u32(attempt);
  for (const row of biomes) hash.str(row);
  hash.bytes(nav.blocked);
  for (const p of pois) hash.str(p.id).str(p.kind).str(p.name).f64(p.pos.x).f64(p.pos.y).f64(p.radiusM);

  return { seed, attempt, sizeM: size, biomeCellM: rules.world.biomeCellM, biomes, nav, pois, hash: hash.digest() };
}

function floodFromEdge(water: Uint8Array, n: number): Uint8Array {
  const ocean = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let tail = 0;
  const push = (i: number) => {
    if (water[i] === 1 && ocean[i] === 0) {
      ocean[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let k = 0; k < n; k++) {
    push(k);
    push((n - 1) * n + k);
    push(k * n);
    push(k * n + n - 1);
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head] as number;
    const x = i % n;
    if (x > 0) push(i - 1);
    if (x < n - 1) push(i + 1);
    if (i >= n) push(i - n);
    if (i < (n - 1) * n) push(i + n);
  }
  return ocean;
}

function buildBiomes(
  rules: Rules,
  n: number,
  cellM: number,
  height: Float32Array,
  water: Uint8Array,
  ocean: Uint8Array,
  moisture: ValueNoise,
  warmth: ValueNoise,
): string[] {
  const size = rules.world.sizeM;
  const bc = rules.world.biomeCellM;
  const cells = size / bc;
  const rows: string[] = [];
  for (let by = 0; by < cells; by++) {
    let row = '';
    for (let bx = 0; bx < cells; bx++) {
      let total = 0;
      let oceanCount = 0;
      let lakeCount = 0;
      let heightSum = 0;
      // Nav cells whose centres fall inside this biome cell.
      const x0 = Math.ceil((bx * bc) / cellM - 0.5);
      const x1 = Math.ceil(((bx + 1) * bc) / cellM - 0.5);
      const y0 = Math.ceil((by * bc) / cellM - 0.5);
      const y1 = Math.ceil(((by + 1) * bc) / cellM - 0.5);
      for (let cy = y0; cy < y1; cy++) {
        for (let cx = x0; cx < x1; cx++) {
          const i = cy * n + cx;
          total++;
          if (ocean[i] === 1) oceanCount++;
          else if (water[i] === 1) lakeCount++;
          else heightSum += height[i] as number;
        }
      }
      const land = total - oceanCount - lakeCount;
      const x = (bx + 0.5) * bc;
      const y = (by + 0.5) * bc;
      let code: string;
      if (oceanCount * 2 >= total) code = 'O';
      else if (lakeCount * 2 >= total) code = 'L';
      else if (oceanCount > 0) code = 'B';
      else if (land > 0 && heightSum / land > MOUNTAIN_LEVEL) code = 'M';
      else {
        const t = 0.75 * (y / size) + 0.25 * warmth.fbm(x, y, 1 / 700, 3);
        const m = moisture.fbm(x, y, 1 / 500, 4);
        if (t < 0.3) code = 'T';
        else if (t > 0.66 && m < 0.5) code = 'D';
        else if (m > 0.55) code = 'F';
        else if (m < 0.45) code = 'S';
        else code = 'G';
      }
      row += code;
    }
    rows.push(row);
  }
  return rows;
}

function placeMonuments(rules: Rules, rng: Rng, nav: NavGrid, height: Float32Array, water: Uint8Array, main: number): Poi[] {
  const size = rules.world.sizeM;
  const names = rng.shuffle(rules.map.monumentNames);
  const candidates: { x: number; y: number }[] = [];
  for (let k = 0; k < 900; k++) candidates.push({ x: rng.range(150, size - 150), y: rng.range(150, size - 150) });

  const fits = (x: number, y: number): boolean => {
    if (nav.regionAt(x, y) !== main) return false;
    if (nav.oceanDistanceM(x, y) < MONUMENT_MIN_OCEAN_DIST_M) return false;
    const i = nav.cellOf(y) * nav.width + nav.cellOf(x);
    const h = height[i] as number;
    if (h < SEA_LEVEL + 0.05 || h > MOUNTAIN_LEVEL - 0.02) return false;
    return footprintIsDry(nav, water, x, y, MONUMENT_RADIUS_M);
  };

  for (const spacing of MONUMENT_SPACING_M) {
    const placed: Poi[] = [];
    for (const c of candidates) {
      if (placed.length >= rules.map.targetMonuments) break;
      if (!fits(c.x, c.y)) continue;
      if (placed.some((p) => sq(p.pos.x - c.x) + sq(p.pos.y - c.y) < spacing * spacing)) continue;
      const name = names[placed.length] as string;
      // Snap to the centre of the nav cell so the POI position is exact and walkable.
      const pos = { x: (nav.cellOf(c.x) + 0.5) * nav.cellM, y: (nav.cellOf(c.y) + 0.5) * nav.cellM };
      placed.push({ id: `mon_${slug(name)}`, kind: 'monument', name, pos, radiusM: MONUMENT_RADIUS_M });
    }
    if (placed.length >= rules.map.minMonuments) return placed;
  }
  return [];
}

function forEachCellInRadius(nav: NavGrid, x: number, y: number, r: number, fn: (i: number) => boolean | void): boolean {
  const c0 = nav.cellOf(x - r);
  const c1 = nav.cellOf(x + r);
  const r0 = nav.cellOf(y - r);
  const r1 = nav.cellOf(y + r);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (!nav.inBounds(cx, cy)) return false;
      const px = (cx + 0.5) * nav.cellM - x;
      const py = (cy + 0.5) * nav.cellM - y;
      if (px * px + py * py > r * r) continue;
      if (fn(cy * nav.width + cx) === false) return false;
    }
  }
  return true;
}

function footprintIsDry(nav: NavGrid, water: Uint8Array, x: number, y: number, r: number): boolean {
  return forEachCellInRadius(nav, x, y, r, (i) => water[i] === 0);
}

function clearFootprint(nav: NavGrid, water: Uint8Array, x: number, y: number, r: number): void {
  forEachCellInRadius(nav, x, y, r, (i) => {
    if (water[i] === 0) nav.blocked[i] = 0;
  });
}

function placeCoasts(rules: Rules, nav: NavGrid, main: number): Poi[] | null {
  const size = rules.world.sizeM;
  const mid = size / 2;
  const score: Record<string, (x: number, y: number) => number> = {
    north: (x, y) => y + 0.6 * Math.abs(x - mid),
    south: (x, y) => size - y + 0.6 * Math.abs(x - mid),
    west: (x, y) => x + 0.6 * Math.abs(y - mid),
    east: (x, y) => size - x + 0.6 * Math.abs(y - mid),
  };
  const coasts: Poi[] = [];
  for (const spec of rules.map.spawnCoasts) {
    const fn = score[spec.side];
    if (!fn) throw new Error(`rules.json: unknown spawn coast side "${spec.side}"`);
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < nav.blocked.length; i++) {
      if (nav.region[i] !== main || (nav.oceanDist[i] as number) > COAST_MAX_OCEAN_DIST_CELLS) continue;
      const cx = i % nav.width;
      const cy = (i - cx) / nav.width;
      const s = fn((cx + 0.5) * nav.cellM, (cy + 0.5) * nav.cellM);
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) return null;
    const cx = best % nav.width;
    const cy = (best - cx) / nav.width;
    coasts.push({
      id: spec.id,
      kind: 'coast',
      name: spec.name,
      pos: { x: (cx + 0.5) * nav.cellM, y: (cy + 0.5) * nav.cellM },
      radiusM: COAST_RADIUS_M,
    });
  }
  for (let i = 0; i < coasts.length; i++) {
    for (let j = i + 1; j < coasts.length; j++) {
      const a = coasts[i]!.pos;
      const b = coasts[j]!.pos;
      if (sq(a.x - b.x) + sq(a.y - b.y) < COAST_MIN_SPACING_M * COAST_MIN_SPACING_M) return null;
    }
  }
  return coasts;
}
