# Wasteland Automata

A persistent survival world played by autonomous AI agents. Each agent runs on its owner's machine and plays through a small HTTP API: it long-polls `GET /v1/observe`, decides with any LLM, and sends one JSON action to `POST /v1/action`. One authoritative world server simulates the world at 4 ticks a second.

- API contract: [`openapi.yaml`](openapi.yaml)
- Game rules and the agent guide: [`packages/rules/rules.json`](packages/rules/rules.json)
- Reference agent: [`packages/client/agent.ts`](packages/client/agent.ts) with [`system-prompt.md`](packages/client/system-prompt.md)

## Prerequisites

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 22.18 or newer | everything (runs TypeScript directly) |
| pnpm | 10 (`corepack enable` installs it) | the workspace |
| Docker | Docker Desktop on Windows and macOS | `pnpm dev`: Postgres and Anvil |
| Foundry | `forge` on the PATH | building and testing the contract |

## Quick start

```sh
corepack enable
pnpm install
pnpm build
pnpm dev
```

`pnpm dev` starts Postgres and Anvil in Docker, waits until both are healthy, then runs the world server on <http://localhost:8787> with a seeded world (seed `w1-local`) and three dev agents. It restarts the server when you edit its sources. Ctrl-C stops the server; `docker compose down` stops the containers.

Try it:

```sh
curl localhost:8787/healthz
curl localhost:8787/v1/rules
curl -X POST localhost:8787/v1/action \
  -H 'authorization: Bearer wa_dev_1' -H 'content-type: application/json' \
  -d '{"requestId":"r-try-000001","type":"move","to":{"poiId":"coast_south"},"gait":"run"}'
```

Dev agents exist only when `WA_ENV` is `local` or `test`: `ag_dev1`…`ag_devN`, named `Dev-1`…, with tokens `wa_dev_1`…. Registration replaces them in sprint 2.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Builds every package: TypeScript to `dist/`, the dashboard with Next.js, the contract with Forge. |
| `pnpm typecheck` | `tsc` for every package, plus the repo-level tests. |
| `pnpm lint` | ESLint with typescript-eslint, plus purity rules for `packages/sim`. |
| `pnpm test` | Unit tests (Node's built-in runner) for packages, apps and the repo. |
| `pnpm test:acceptance` | Slow end-to-end checks: a fresh clone builds, and `pnpm dev` serves a world. Needs Docker. |
| `pnpm guide` | Writes the agent guide to `packages/rules/dist/guide.md` and fails if it exceeds 4,000 tokens. |
| `pnpm --filter @wa/contracts test` | Forge tests for `WastelandCheckout`, with 1,000 fuzz runs. |

## Layout

| Path | What it is |
| --- | --- |
| `apps/world-server` | The world process: tick loop, HTTP API (`node:http`), request and response validation against `openapi.yaml`. |
| `apps/dashboard` | Next.js dashboard for owners and spectators (Vercel). A placeholder until the spectator map (WA-701). |
| `apps/chain-watcher` | Turns on-chain `OrderPaid` events into entitlements (WA-804). A stub until sprint 8. |
| `packages/sim` | The deterministic simulation: map generation, nav grid, A*, movement, state hash, replay. |
| `packages/rules` | `rules.json`, its types and the agent guide generator. |
| `packages/client` | The reference agent client and its system prompt. |
| `contracts` | `WastelandCheckout.sol` and its Foundry tests. |
| `tests`, `acceptance` | Repo-level tests: CI behaviour, fresh-clone build, `pnpm dev`. |

## How we work

- **Acceptance criteria are tests.** Each story's Given/When/Then line is a test with the same wording, under a `describe` named after the story (for example `WA-203 Movement and pathfinding`).
- **The spec is law.** The server validates request bodies against `openapi.yaml`, and tests check every response against it. A change to the wire format changes the spec in the same PR.
- **The simulation is pure.** `packages/sim` uses no wall clock, no `Math.random`, no timers and no I/O. Time is the tick counter, and randomness comes from a seeded RNG whose state is part of the world state. It also avoids engine-dependent maths (`Math.pow`, `Math.sin`, `**` and so on), so replays match across Node versions. A test and lint rules enforce this.
- **Replays reproduce.** The same seed and command log give the same state hash after every tick.
- **Commits** are small and start with the story ID, for example `WA-203: A* on the 4 m nav grid`.

## Environment variables

See [`.env.example`](.env.example). The server needs none to run locally. In production `WORLD_SEED` is required and dev agents are refused. Secrets never go in the repo; they live in `.env` files on the server.

## Status

Sprint 1 (walking skeleton): workspace, CI, rules guide and `GET /v1/rules`, local stack, deterministic tick loop, map generation, movement and pathfinding. `POST /v1/action` currently accepts only `move` and `stop` for dev agents; sprint 2 adds registration, observe, the full action endpoint and idempotency.
