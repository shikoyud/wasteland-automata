/** Server configuration from environment variables. Secrets never have defaults. */
export type Env = 'local' | 'test' | 'production';

export interface Config {
  env: Env;
  port: number;
  host: string;
  worldId: string;
  worldSeed: string;
  /** Agents spawned at boot with fixed tokens, for local play and tests. Always 0 in production. */
  devAgents: number;
  /** Unused until registration and snapshots (sprint 2 and 3) need Postgres. */
  databaseUrl: string | null;
}

const ENVS: readonly Env[] = ['local', 'test', 'production'];

function int(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}, got "${raw}"`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const mode = (env.WA_ENV ?? 'local') as Env;
  if (!ENVS.includes(mode)) throw new Error(`WA_ENV must be one of ${ENVS.join(', ')}, got "${env.WA_ENV}"`);
  const worldId = env.WORLD_ID || 'w1';
  if (mode === 'production' && !env.WORLD_SEED) throw new Error('WORLD_SEED is required in production (the season seed decides the map)');
  const devAgents = int('DEV_AGENTS', env.DEV_AGENTS, mode === 'production' ? 0 : 3, 0, 50);
  if (mode === 'production' && devAgents > 0) throw new Error('dev agents are not allowed in production');
  return {
    env: mode,
    port: int('PORT', env.PORT, 8787, 0, 65535),
    host: env.HOST || '0.0.0.0',
    worldId,
    worldSeed: env.WORLD_SEED || `${worldId}-local`,
    devAgents,
    databaseUrl: env.DATABASE_URL || null,
  };
}

export interface DevAgent {
  id: string;
  name: string;
  token: string;
}

/** Fixed, documented dev agents: ag_dev1 / Dev-1 / wa_dev_1, and so on. */
export function devAgents(count: number): DevAgent[] {
  return Array.from({ length: count }, (_, i) => ({ id: `ag_dev${i + 1}`, name: `Dev-${i + 1}`, token: `wa_dev_${i + 1}` }));
}
