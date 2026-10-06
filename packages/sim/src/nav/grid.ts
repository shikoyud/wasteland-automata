/**
 * The navigation grid: square cells (4 m on the real map), each open or blocked.
 * Movement is 8-directional without cutting corners, which makes two cells mutually reachable
 * exactly when they are 4-connected, so connected regions are labelled with a 4-neighbour flood fill.
 */
export const NO_REGION = -1;
export const FAR = 0xffff;

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly cellM: number;
  /** 1 = blocked, 0 = open. Row-major, row 0 is the north edge. */
  readonly blocked: Uint8Array;
  /** Region label per cell, or NO_REGION for blocked cells. */
  readonly region: Int32Array;
  regionSizes: number[] = [];
  /** Distance to the nearest ocean cell in cells (4-neighbour steps), or FAR. */
  readonly oceanDist: Uint16Array;

  constructor(width: number, height: number, cellM: number, blocked?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.cellM = cellM;
    this.blocked = blocked ?? new Uint8Array(width * height);
    this.region = new Int32Array(width * height).fill(NO_REGION);
    this.oceanDist = new Uint16Array(width * height).fill(FAR);
    this.labelRegions();
  }

  /** Builds a grid from rows of '.' (open) and '#' (blocked). Handy in tests. */
  static fromAscii(rows: readonly string[], cellM = 4): NavGrid {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const blocked = new Uint8Array(width * height);
    rows.forEach((row, y) => {
      for (let x = 0; x < width; x++) blocked[y * width + x] = row[x] === '#' ? 1 : 0;
    });
    return new NavGrid(width, height, cellM, blocked);
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  isOpenCell(cx: number, cy: number): boolean {
    return this.inBounds(cx, cy) && this.blocked[cy * this.width + cx] === 0;
  }

  cellOf(m: number): number {
    return Math.floor(m / this.cellM);
  }

  isWalkable(x: number, y: number): boolean {
    return this.isOpenCell(this.cellOf(x), this.cellOf(y));
  }

  regionAt(x: number, y: number): number {
    const cx = this.cellOf(x);
    const cy = this.cellOf(y);
    return this.inBounds(cx, cy) ? (this.region[cy * this.width + cx] as number) : NO_REGION;
  }

  oceanDistanceM(x: number, y: number): number {
    const cx = this.cellOf(x);
    const cy = this.cellOf(y);
    if (!this.inBounds(cx, cy)) return 0;
    const d = this.oceanDist[cy * this.width + cx] as number;
    return d === FAR ? Infinity : d * this.cellM;
  }

  /** The label of the largest open region. */
  largestRegion(): number {
    let best = NO_REGION;
    let size = -1;
    this.regionSizes.forEach((s, i) => {
      if (s > size) {
        size = s;
        best = i;
      }
    });
    return best;
  }

  /** Recomputes region labels after cells change. */
  labelRegions(): void {
    const { width, height, blocked, region } = this;
    region.fill(NO_REGION);
    this.regionSizes = [];
    const queue = new Int32Array(width * height);
    let label = 0;
    let tail = 0;
    const visit = (j: number): void => {
      if (blocked[j] === 0 && region[j] === NO_REGION) {
        region[j] = label;
        queue[tail++] = j;
      }
    };
    for (let start = 0; start < blocked.length; start++) {
      if (blocked[start] !== 0 || region[start] !== NO_REGION) continue;
      label = this.regionSizes.length;
      let head = 0;
      tail = 0;
      visit(start);
      while (head < tail) {
        const i = queue[head++] as number;
        const x = i % width;
        if (x > 0) visit(i - 1);
        if (x < width - 1) visit(i + 1);
        if (i >= width) visit(i - width);
        if (i < (height - 1) * width) visit(i + width);
      }
      this.regionSizes.push(tail);
    }
  }

  /** Multi-source BFS: distance from every cell to the nearest cell flagged in `ocean`. */
  computeOceanDistance(ocean: Uint8Array): void {
    const { width, height, oceanDist } = this;
    oceanDist.fill(FAR);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < ocean.length; i++) {
      if (ocean[i] === 1) {
        oceanDist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++] as number;
      const d = (oceanDist[i] as number) + 1;
      const x = i % width;
      const y = (i - x) / width;
      const push = (j: number) => {
        if ((oceanDist[j] as number) > d) {
          oceanDist[j] = d;
          queue[tail++] = j;
        }
      };
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (y > 0) push(i - width);
      if (y < height - 1) push(i + width);
    }
  }
}
