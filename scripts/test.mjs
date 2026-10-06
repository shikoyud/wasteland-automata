#!/usr/bin/env node
// Runs a test suite with Node's built-in test runner, on the TypeScript sources directly.
//   node scripts/test.mjs unit          packages, apps and repo-level tests (pnpm test)
//   node scripts/test.mjs acceptance    slow end-to-end checks: fresh-clone build, pnpm dev (pnpm test:acceptance)
//   node scripts/test.mjs --files a.ts  just these files
// On GitHub Actions it also prints one ::error annotation per failing test, naming it.
import { spawnSync } from 'node:child_process';

const SUITES = {
  unit: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
  acceptance: ['acceptance/**/*.test.ts'],
};

const args = process.argv.slice(2);
const files = args[0] === '--files' ? args.slice(1) : SUITES[args[0] ?? 'unit'];
if (!files || files.length === 0) {
  process.stderr.write(`Usage: node scripts/test.mjs [${Object.keys(SUITES).join('|')}] | --files <file>...\n`);
  process.exit(2);
}

const reporters = ['--test-reporter=spec', '--test-reporter-destination=stdout'];
if (process.env.GITHUB_ACTIONS === 'true') {
  reporters.push(`--test-reporter=${new URL('./gha-reporter.mjs', import.meta.url).href}`, '--test-reporter-destination=stdout');
}

// If this script itself runs inside a node:test process, NODE_TEST_CONTEXT would make the child
// report to that parent and exit 0 even when tests fail. Always run as a top-level test run.
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const result = spawnSync(process.execPath, ['--conditions=source', '--test', ...reporters, ...files], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
