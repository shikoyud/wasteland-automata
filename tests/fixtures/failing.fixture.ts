// A deliberately failing unit test. Only tests/wa-102.test.ts runs it, to prove CI fails and names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the answer is 42', () => {
  assert.equal(6 * 7, 41);
});

test('a passing neighbour', () => {
  assert.equal(1 + 1, 2);
});
