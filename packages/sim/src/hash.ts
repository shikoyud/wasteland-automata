/**
 * A fast, deterministic 64-bit state hash (two independent 32-bit lanes with murmur3-style mixing).
 * Not cryptographic: it detects divergence between two simulation runs, nothing more.
 */
const f64 = new Float64Array(1);
const f64Words = new Uint32Array(f64.buffer);

function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Hasher {
  private h1 = 0x9747b28c;
  private h2 = 0x3c6ef372;
  private words = 0;

  u32(value: number): this {
    const w = value >>> 0;
    this.h1 = mix(this.h1, w);
    this.h2 = mix(this.h2, w ^ 0x5bd1e995);
    this.words++;
    return this;
  }

  i32(value: number): this {
    return this.u32(value | 0);
  }

  f64(value: number): this {
    f64[0] = value;
    return this.u32(f64Words[0] as number).u32(f64Words[1] as number);
  }

  bool(value: boolean): this {
    return this.u32(value ? 1 : 0);
  }

  str(value: string): this {
    this.u32(value.length);
    for (let i = 0; i < value.length; i++) this.u32(value.charCodeAt(i));
    return this;
  }

  /** Hashes a nullable string: null and "" hash differently. */
  optStr(value: string | null): this {
    return value === null ? this.u32(0xffffffff) : this.str(value);
  }

  bytes(values: ArrayLike<number>): this {
    this.u32(values.length);
    for (let i = 0; i < values.length; i++) this.u32(values[i] as number);
    return this;
  }

  digest(): string {
    const a = fmix(this.h1 ^ this.words);
    const b = fmix(this.h2 ^ Math.imul(this.words, 0x27d4eb2d));
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
}
