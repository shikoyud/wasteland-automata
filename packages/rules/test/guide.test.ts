import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rules, generateGuide, canonicalJson, type Rules } from '../src/index.ts';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const clone = (): Rules => JSON.parse(JSON.stringify(rules)) as Rules;

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['src/cli.ts', ...args], { cwd: pkgDir, encoding: 'utf8' });
}

describe('WA-103 rules.json, guide generator and GET /v1/rules', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'wa-guide-'));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('Given rules.json, when the generator runs in CI, then it writes the guide, and CI fails if the guide exceeds 4,000 tokens', () => {
    const out = join(dir, 'guide.md');
    const ok = runCli(['--out', out, '--max-tokens', '4000']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readFileSync(out, 'utf8'), generateGuide(rules));
    assert.match(ok.stdout, /tokens/);

    const big = clone();
    big.economy.faucets = Array.from({ length: 600 }, (_, i) => `faucet number ${i} with a long and winding description`);
    const bigRules = join(dir, 'big-rules.json');
    writeFileSync(bigRules, JSON.stringify(big));
    const over = runCli(['--rules', bigRules, '--out', join(dir, 'big-guide.md'), '--max-tokens', '4000']);
    assert.equal(over.status, 1, 'an oversized guide must fail the run');
    assert.match(over.stderr, /exceeds the 4,000-token cap/);
  });
});

describe('guide generator', () => {
  test('the same rules always give the same guide', () => {
    assert.equal(generateGuide(clone()), generateGuide(clone()));
  });

  test('the guide states the rules version', () => {
    assert.ok(generateGuide(rules).includes(rules.rulesVersion));
  });

  test('numbers come from rules.json, not from the generator', () => {
    const changed = clone();
    const run = changed.movement.gaits.find((g) => g.id === 'run');
    assert.ok(run);
    run.speedMps = 7.25;
    changed.raids.windowsUtc[0] = { opens: '02:00', closes: '04:00' };
    changed.presence.sleeperMinutes = 9;
    const guide = generateGuide(changed);
    assert.ok(guide.includes('7.25 m/s'), 'run speed');
    assert.ok(guide.includes('02:00–04:00'), 'raid window');
    assert.ok(guide.includes('9 minutes'), 'sleeper time');
  });

  test('every biome is listed by name and code', () => {
    const guide = generateGuide(rules);
    for (const b of rules.biomes) assert.ok(guide.includes(`${b.name} (${b.code})`), b.id);
  });

  test('nothing is left unfilled', () => {
    const guide = generateGuide(rules);
    for (const bad of ['undefined', 'NaN', '[object Object]', '{{']) assert.ok(!guide.includes(bad), bad);
  });
});

describe('canonical JSON', () => {
  test('key order does not change the output', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } }), canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }));
  });

  test('it is compact JSON with sorted keys', () => {
    assert.equal(canonicalJson({ b: 1, a: [true, null] }), '{"a":[true,null],"b":1}');
  });
});
