import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { devAgents, loadConfig } from '../src/config.ts';

describe('server config', () => {
  test('local defaults: port 8787, world w1, a fixed local seed and 3 dev agents', () => {
    assert.deepEqual(loadConfig({}), {
      env: 'local',
      port: 8787,
      host: '0.0.0.0',
      worldId: 'w1',
      worldSeed: 'w1-local',
      devAgents: 3,
      databaseUrl: null,
    });
  });

  test('environment variables override the defaults', () => {
    const c = loadConfig({ WA_ENV: 'test', PORT: '9000', HOST: '127.0.0.1', WORLD_ID: 'w2', WORLD_SEED: 's9', DEV_AGENTS: '5', DATABASE_URL: 'postgres://x' });
    assert.equal(c.env, 'test');
    assert.equal(c.port, 9000);
    assert.equal(c.worldSeed, 's9');
    assert.equal(c.devAgents, 5);
    assert.equal(c.databaseUrl, 'postgres://x');
  });

  test('production needs an explicit seed and never has dev agents', () => {
    assert.throws(() => loadConfig({ WA_ENV: 'production' }), /WORLD_SEED/);
    assert.equal(loadConfig({ WA_ENV: 'production', WORLD_SEED: 'w1-s1' }).devAgents, 0);
    assert.throws(() => loadConfig({ WA_ENV: 'production', WORLD_SEED: 'w1-s1', DEV_AGENTS: '2' }), /dev agents/);
  });

  test('bad values are refused with a clear message', () => {
    assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
    assert.throws(() => loadConfig({ WA_ENV: 'staging-ish' }), /WA_ENV/);
    assert.throws(() => loadConfig({ DEV_AGENTS: '-1' }), /DEV_AGENTS/);
  });

  test('dev agents get fixed ids, names and tokens', () => {
    assert.deepEqual(devAgents(2), [
      { id: 'ag_dev1', name: 'Dev-1', token: 'wa_dev_1' },
      { id: 'ag_dev2', name: 'Dev-2', token: 'wa_dev_2' },
    ]);
  });
});
