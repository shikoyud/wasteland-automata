import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { canonicalJson, generateGuide, type Rules } from '@wa/rules';
import { sendJson } from '../http.ts';

/** "sha256:" + hex SHA-256 of the canonical JSON of the rules: equal rules give equal hashes. */
export function rulesHash(rules: Rules): string {
  return `sha256:${createHash('sha256').update(canonicalJson(rules)).digest('hex')}`;
}

/** GET /v1/rules. The body never changes while the process runs, so it is built once. */
export function rulesRoute(rules: Rules): (res: ServerResponse) => void {
  const body = JSON.stringify({
    rulesVersion: rules.rulesVersion,
    rulesHash: rulesHash(rules),
    guide: generateGuide(rules),
    changes: [],
  });
  return (res) => sendJson(res, 200, body, { 'x-rules-version': rules.rulesVersion });
}
