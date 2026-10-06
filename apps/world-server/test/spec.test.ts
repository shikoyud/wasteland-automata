import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_STATUS } from '../src/errors.ts';
import { testSpec } from './helpers.ts';

describe('openapi.yaml validator', () => {
  test('the spec\'s own examples pass: ObserveUnderFire is an Observe, ResMove an ActionResult', () => {
    const spec = testSpec();
    const examples = spec.doc.components.examples as Record<string, { value: unknown }>;
    assert.equal(spec.check('#/components/schemas/Observe', examples.ObserveUnderFire?.value), null);
    assert.equal(spec.check('#/components/schemas/ActionResult', examples.ResMove?.value), null);
  });

  test('a body that breaks the schema is caught and the field is named', () => {
    const spec = testSpec();
    const problem = spec.check('#/components/schemas/ActionResult', { ok: true, requestId: 'r-1', replayed: false, kind: 'order' });
    assert.ok(problem);
    assert.match(problem.message, /cursor/);
  });

  test('a move action is validated against MoveAction, so a missing `to` is named', () => {
    const r = testSpec().checkAction({ requestId: 'r-12345678', type: 'move' });
    assert.deepEqual(r, { ok: false, path: '/to', message: "must have required property 'to'" });
  });

  test('every error code the server uses has the HTTP status openapi.yaml gives it', () => {
    assert.deepEqual(ERROR_STATUS, testSpec().errorCodes());
  });
});
