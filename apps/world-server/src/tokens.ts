import { createHash } from 'node:crypto';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * Bearer tokens, stored only as SHA-256 hashes. Sprint 1 fills it with dev agents' fixed tokens
 * in local and test; registration (WA-501) moves it to Postgres.
 */
export class TokenTable {
  private readonly byHash = new Map<string, string>();

  add(token: string, agentId: string): void {
    this.byHash.set(sha256(token), agentId);
  }

  agentFor(token: string | null): string | undefined {
    return token ? this.byHash.get(sha256(token)) : undefined;
  }

  get size(): number {
    return this.byHash.size;
  }
}
