/**
 * Shortest paths on the nav grid: A* over 8-directional moves without corner cutting, then string
 * pulling, so bodies walk straight lines between corners instead of zig-zagging along cells.
 * Unreachable destinations are rejected in O(1) by comparing region labels before any search.
 */
import type { Vec2 } from '../types.ts';
import { NO_REGION, type NavGrid } from './grid.ts';

export type PathFailure = 'out_of_bounds' | 'blocked_destination' | 'blocked_start' | 'unreachable';
export type PathResult = { ok: true; points: Vec2[]; lengthM: number } | { ok: false; reason: PathFailure };

/** How far (in cells) a destination in a blocked cell may be moved to the nearest open cell. */
const SNAP_CELLS = 2;
const SQRT2 = Math.SQRT2;
// Neighbour order is fixed so searches are reproducible: E, W, S, N, then diagonals.
const DX = [1, -1, 0, 0, 1, -1, 1, -1] as const;
const DY = [0, 0, 1, -1, 1, 1, -1, -1] as const;

/** Per-grid scratch buffers, reused across searches (cleared lazily with a search stamp). */
class Scratch {
  readonly g: Float64Array;
  readonly parent: Int32Array;
  readonly stamp: Uint32Array;
  readonly closed: Uint32Array;
  heapNode: Int32Array;
  heapF: Float64Array;
  search = 0;

  constructor(cells: number) {
    this.g = new Float64Array(cells);
    this.parent = new Int32Array(cells);
    this.stamp = new Uint32Array(cells);
    this.closed = new Uint32Array(cells);
    this.heapNode = new Int32Array(1024);
    this.heapF = new Float64Array(1024);
  }
}

const scratchByGrid = new WeakMap<NavGrid, Scratch>();

function scratchFor(grid: NavGrid): Scratch {
  let s = scratchByGrid.get(grid);
  if (!s) {
    s = new Scratch(grid.width * grid.height);
    scratchByGrid.set(grid, s);
  }
  return s;
}

/** Finds the open cell nearest to (cx, cy) within SNAP_CELLS, preferring `region` when given. */
function snap(grid: NavGrid, cx: number, cy: number, region: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let dy = -SNAP_CELLS; dy <= SNAP_CELLS; dy++) {
    for (let dx = -SNAP_CELLS; dx <= SNAP_CELLS; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!grid.isOpenCell(x, y)) continue;
      const i = y * grid.width + x;
      if (region !== NO_REGION && grid.region[i] !== region) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

const centreOf = (grid: NavGrid, i: number): Vec2 => {
  const cx = i % grid.width;
  return { x: (cx + 0.5) * grid.cellM, y: ((i - cx) / grid.width + 0.5) * grid.cellM };
};

export function findPath(grid: NavGrid, from: Vec2, to: Vec2): PathResult {
  const w = grid.width;
  const sx = grid.cellOf(from.x);
  const sy = grid.cellOf(from.y);
  const tx = grid.cellOf(to.x);
  const ty = grid.cellOf(to.y);
  if (!grid.inBounds(tx, ty) || !grid.inBounds(sx, sy)) return { ok: false, reason: 'out_of_bounds' };

  let start = sy * w + sx;
  let startPoint = from;
  if (!grid.isOpenCell(sx, sy)) {
    start = snap(grid, sx, sy, NO_REGION);
    if (start < 0) return { ok: false, reason: 'blocked_start' };
    startPoint = centreOf(grid, start);
  }
  const region = grid.region[start] as number;

  let goal = ty * w + tx;
  let goalPoint = to;
  if (!grid.isOpenCell(tx, ty)) {
    goal = snap(grid, tx, ty, region);
    if (goal < 0) return { ok: false, reason: snap(grid, tx, ty, NO_REGION) < 0 ? 'blocked_destination' : 'unreachable' };
    goalPoint = centreOf(grid, goal);
  }
  if (grid.region[goal] !== region) return { ok: false, reason: 'unreachable' };

  const cells = start === goal ? [start] : astar(grid, start, goal);
  if (!cells) return { ok: false, reason: 'unreachable' };
  const points = pull(grid, startPoint, goalPoint, cells);
  let lengthM = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    lengthM += Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }
  return { ok: true, points, lengthM };
}

function astar(grid: NavGrid, start: number, goal: number): number[] | null {
  const s = scratchFor(grid);
  const w = grid.width;
  const h = grid.height;
  const blocked = grid.blocked;
  const gx = goal % w;
  const gy = (goal - gx) / w;
  const id = ++s.search;
  const { g, parent, stamp, closed } = s;
  let size = 0;

  const heuristic = (i: number): number => {
    const x = i % w;
    const dx = Math.abs(x - gx);
    const dy = Math.abs((i - x) / w - gy);
    return dx < dy ? dy + (SQRT2 - 1) * dx : dx + (SQRT2 - 1) * dy;
  };
  const push = (node: number, f: number): void => {
    if (size === s.heapNode.length) {
      const nn = new Int32Array(size * 2);
      nn.set(s.heapNode);
      const nf = new Float64Array(size * 2);
      nf.set(s.heapF);
      s.heapNode = nn;
      s.heapF = nf;
    }
    const hn = s.heapNode;
    const hf = s.heapF;
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if ((hf[p] as number) <= f) break;
      hn[k] = hn[p] as number;
      hf[k] = hf[p] as number;
      k = p;
    }
    hn[k] = node;
    hf[k] = f;
  };
  const pop = (): number => {
    const hn = s.heapNode;
    const hf = s.heapF;
    const top = hn[0] as number;
    const lastN = hn[--size] as number;
    const lastF = hf[size] as number;
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && (hf[c + 1] as number) < (hf[c] as number)) c++;
      if ((hf[c] as number) >= lastF) break;
      hn[k] = hn[c] as number;
      hf[k] = hf[c] as number;
      k = c;
    }
    hn[k] = lastN;
    hf[k] = lastF;
    return top;
  };

  stamp[start] = id;
  g[start] = 0;
  parent[start] = -1;
  push(start, heuristic(start));

  while (size > 0) {
    const cur = pop();
    if (closed[cur] === id) continue;
    closed[cur] = id;
    if (cur === goal) {
      const out: number[] = [];
      for (let n = goal; n !== -1; n = parent[n] as number) out.push(n);
      return out.reverse();
    }
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const gc = g[cur] as number;
    for (let d = 0; d < 8; d++) {
      const nx = cx + (DX[d] as number);
      const ny = cy + (DY[d] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (blocked[ni] !== 0 || closed[ni] === id) continue;
      let cost = 1;
      if (d >= 4) {
        // Diagonal: both orthogonal neighbours must be open, so bodies never clip a corner.
        if (blocked[cy * w + nx] !== 0 || blocked[ny * w + cx] !== 0) continue;
        cost = SQRT2;
      }
      const ng = gc + cost;
      if (stamp[ni] !== id || ng < (g[ni] as number)) {
        stamp[ni] = id;
        g[ni] = ng;
        parent[ni] = cur;
        push(ni, ng + heuristic(ni));
      }
    }
  }
  return null;
}

/** Greedy string pulling: keep only the corners the body can't see past. */
function pull(grid: NavGrid, startPoint: Vec2, goalPoint: Vec2, cells: readonly number[]): Vec2[] {
  const waypoints = cells.map((i) => centreOf(grid, i));
  waypoints[0] = startPoint;
  waypoints[waypoints.length - 1] = goalPoint;
  if (waypoints.length === 1) waypoints.push(goalPoint);
  const out: Vec2[] = [startPoint];
  let anchor = startPoint;
  for (let i = 1; i < waypoints.length - 1; i++) {
    if (!lineOfSight(grid, anchor, waypoints[i + 1] as Vec2)) {
      anchor = waypoints[i] as Vec2;
      out.push(anchor);
    }
  }
  out.push(goalPoint);
  return out;
}

/**
 * True when the straight segment a→b touches only open cells (a supercover walk: a segment that
 * passes exactly through a cell corner must have both neighbouring cells open).
 */
export function lineOfSight(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  const size = grid.cellM;
  let cx = grid.cellOf(a.x);
  let cy = grid.cellOf(a.y);
  const ex = grid.cellOf(b.x);
  const ey = grid.cellOf(b.y);
  if (!grid.isOpenCell(cx, cy) || !grid.isOpenCell(ex, ey)) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? size / Math.abs(dx) : Infinity;
  const tDeltaY = stepY !== 0 ? size / Math.abs(dy) : Infinity;
  let tMaxX = stepX > 0 ? ((cx + 1) * size - a.x) / dx : stepX < 0 ? (cx * size - a.x) / dx : Infinity;
  let tMaxY = stepY > 0 ? ((cy + 1) * size - a.y) / dy : stepY < 0 ? (cy * size - a.y) / dy : Infinity;
  const limit = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
  for (let k = 0; k < limit && (cx !== ex || cy !== ey); k++) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      cy += stepY;
      tMaxY += tDeltaY;
    } else {
      // Exactly through a corner: both side cells must be open.
      if (!grid.isOpenCell(cx + stepX, cy) || !grid.isOpenCell(cx, cy + stepY)) return false;
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
    if (!grid.isOpenCell(cx, cy)) return false;
  }
  return true;
}
