import type { Rng } from '../rng.ts';

/** Seeded 2D value noise with quintic smoothing. Output in [0, 1). Uses only + - * and floor. */
export class ValueNoise {
  private readonly perm = new Uint8Array(512);
  private readonly values = new Float64Array(256);

  constructor(rng: Rng) {
    const order = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
    for (let i = 0; i < 512; i++) this.perm[i] = order[i & 255] as number;
    for (let i = 0; i < 256; i++) this.values[i] = rng.next();
  }

  private lattice(ix: number, iy: number): number {
    const p = this.perm;
    return this.values[p[(p[ix & 255] as number) + (iy & 255)] as number] as number;
  }

  at(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.lattice(ix, iy);
    const b = this.lattice(ix + 1, iy);
    const c = this.lattice(ix, iy + 1);
    const d = this.lattice(ix + 1, iy + 1);
    const top = a + (b - a) * u;
    const bottom = c + (d - c) * u;
    return top + (bottom - top) * v;
  }

  /** Fractal sum of octaves, normalised back to [0, 1). `scale` is in noise units per metre. */
  fbm(x: number, y: number, scale: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = scale;
    for (let o = 0; o < octaves; o++) {
      // Offset each octave so lattice points don't line up across octaves.
      sum += amp * this.at(x * f + o * 17.31, y * f + o * 9.73);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}
