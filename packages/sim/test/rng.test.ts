import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/rng.ts';

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.nextU32());

describe('seeded RNG', () => {
  test('the same seed gives the same sequence', () => {
    assert.deepEqual(take(Rng.fromSeed('w1-s1'), 50), take(Rng.fromSeed('w1-s1'), 50));
  });

  test('different seeds give different sequences', () => {
    assert.notDeepEqual(take(Rng.fromSeed('w1-s1'), 10), take(Rng.fromSeed('w1-s2'), 10));
  });

  test('next() stays in [0, 1)', () => {
    const rng = Rng.fromSeed('range');
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });

  test('int(lo, hi) is inclusive and covers every value', () => {
    const rng = Rng.fromSeed('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const v = rng.int(3, 7);
      assert.ok(Number.isInteger(v) && v >= 3 && v <= 7, `bad int: ${v}`);
      seen.add(v);
    }
    assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7]);
  });

  test('saving and restoring the state continues the same sequence', () => {
    const a = Rng.fromSeed('state');
    take(a, 7);
    const b = Rng.fromState(a.state());
    assert.deepEqual(take(a, 20), take(b, 20));
  });
});
