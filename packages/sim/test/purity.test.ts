import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

/** Code without comments, so prose like "never calls Math.random()" doesn't trip the checks. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const FORBIDDEN: [RegExp, string][] = [
  [/\bDate\b/, 'Date (time comes from the tick counter)'],
  [/Math\.random/, 'Math.random (use the seeded Rng)'],
  [/\bperformance\b|\bprocess\b|\bglobalThis\b/, 'host globals'],
  [/\b(setTimeout|setInterval|setImmediate|queueMicrotask)\b/, 'timers'],
  [/\b(fetch|require)\s*\(|\bcrypto\b/, 'I/O or host APIs'],
  [/localeCompare|toLocale\w*|\bIntl\b/, 'locale-dependent formatting'],
  [/Math\.(pow|hypot|exp|expm1|log\w*|sin\w*|cos\w*|tan\w*|atan\w*|asin\w*|acos\w*|cbrt)\b/, 'transcendental Math (results may differ across engines)'],
  [/[\w)\]]\s*\*\*\s*[\w(]/, 'the ** operator (use multiplication)'],
];

describe('packages/sim stays pure', () => {
  const files = sources(srcDir);

  test('there are simulation sources to check', () => {
    assert.ok(files.length >= 8);
  });

  test('no wall clock, Math.random, timers, I/O or engine-dependent maths', () => {
    const problems: string[] = [];
    for (const f of files) {
      const text = code(f);
      for (const [re, what] of FORBIDDEN) if (re.test(text)) problems.push(`${f.slice(srcDir.length)}: ${what}`);
    }
    assert.deepEqual(problems, []);
  });

  test('imports are relative, or type-only from @wa/rules', () => {
    const problems: string[] = [];
    for (const f of files) {
      for (const m of code(f).matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const [, , typeOnly, spec] = m;
        if (spec?.startsWith('.')) continue;
        if (spec === '@wa/rules' && typeOnly) continue;
        problems.push(`${f.slice(srcDir.length)}: imports "${spec}"`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
