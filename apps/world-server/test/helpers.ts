import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { rules } from '@wa/rules';
import { generateMap, World, type GameMap } from '@wa/sim';
import { createApp, type App } from '../src/app.ts';
import { Spec } from '../src/spec.ts';
import { TokenTable } from '../src/tokens.ts';

export const TEST_SEED = 'test-world';
export const DEV_TOKEN = 'wa_dev_test_1';
export const DEV_AGENT = 'ag_dev1';

let map: GameMap | undefined;
let spec: Spec | undefined;

export const testSpec = (): Spec => (spec ??= Spec.load());
const testMap = (): GameMap => (map ??= generateMap(TEST_SEED, rules));

export interface TestServer {
  url: string;
  world: World;
  app: App;
  close: () => Promise<void>;
}

/** A real HTTP server on a free port, with one dev agent spawned. The tick loop is not running: tests step the world. */
export async function startServer(): Promise<TestServer> {
  const world = new World({ seed: TEST_SEED, rules, map: testMap() });
  world.apply(DEV_AGENT, { type: 'spawn', name: 'Rook-9' });
  const tokens = new TokenTable();
  tokens.add(DEV_TOKEN, DEV_AGENT);
  const app = createApp({ world, rules, spec: testSpec(), worldId: 'w1', tokens });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    world,
    app,
    close: () => new Promise<void>((resolve) => app.server.close(() => resolve())),
  };
}

/** Asserts that a response body matches the schema openapi.yaml declares for that operation and status. */
export function assertMatchesSpec(method: string, path: string, status: number, body: unknown): void {
  const problem = testSpec().checkResponse(method, path, status, body);
  assert.equal(problem, null, `${method.toUpperCase()} ${path} ${status} does not match openapi.yaml: ${JSON.stringify(problem)}`);
}

export async function call(
  server: TestServer,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null; raw?: string } = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = opts.token === undefined ? DEV_TOKEN : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(server.url + path, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as unknown) : null };
}
