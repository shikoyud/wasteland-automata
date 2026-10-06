import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Hasher } from '../src/hash.ts';

const digestOf = (fill: (h: Hasher) => void): string => {
  const h = new Hasher();
  fill(h);
  return h.digest();
};

describe('state hasher', () => {
  test('the digest is 16 lowercase hex characters', () => {
    assert.match(digestOf((h) => h.str('hello')), /^[0-9a-f]{16}$/);
  });

  test('the same input gives the same digest', () => {
    const fill = (h: Hasher) => h.u32(7).f64(412.125).str('Rook-9').bool(true);
    assert.equal(digestOf(fill), digestOf(fill));
  });

  test('the digest depends on order', () => {
    assert.notEqual(digestOf((h) => h.u32(1).u32(2)), digestOf((h) => h.u32(2).u32(1)));
  });

  test('a one-bit change in a float changes the digest', () => {
    assert.notEqual(digestOf((h) => h.f64(1)), digestOf((h) => h.f64(1 + Number.EPSILON)));
  });

  test('strings are length-prefixed, so splits differ', () => {
    assert.notEqual(digestOf((h) => h.str('ab').str('c')), digestOf((h) => h.str('a').str('bc')));
  });

  test('an empty hasher still gives a stable digest', () => {
    assert.equal(digestOf(() => {}), digestOf(() => {}));
  });
});
