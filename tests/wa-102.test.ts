import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Runs the exact test command CI uses (scripts/test.mjs) on the failing fixture, as GitHub Actions would. */
function runCiTests(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/test.mjs', '--files', 'tests/fixtures/failing.fixture.ts'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}

describe('WA-102 CI on every push', () => {
  test('Given a commit with a failing unit test, when GitHub Actions runs, then the check fails and names the test', () => {
    const workflow = readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8');
    assert.match(workflow, /^on:\s*\n\s+push:/m, 'the workflow runs on every push');
    assert.match(workflow, /run: pnpm test\s*$/m, 'the workflow runs the unit tests with pnpm test');
    const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts.test, 'node scripts/test.mjs unit', 'pnpm test runs scripts/test.mjs');

    const r = runCiTests({ GITHUB_ACTIONS: 'true' });
    assert.notEqual(r.status, 0, 'a failing test must fail the check');
    assert.match(
      r.stdout,
      /^::error file=tests\/fixtures\/failing\.fixture\.ts,line=\d+,col=\d+,title=Test failed%3A the answer is 42::/m,
      `no GitHub annotation naming the test in:\n${r.stdout}`,
    );
    assert.doesNotMatch(r.stdout, /title=Test failed%3A a passing neighbour/);
  });
});

describe('test runner outside GitHub Actions', () => {
  test('a local run fails and names the test without printing annotations', () => {
    const env: Record<string, string> = { GITHUB_ACTIONS: '' };
    const r = runCiTests(env);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /the answer is 42/);
    assert.doesNotMatch(r.stdout, /^::error/m);
  });
});
