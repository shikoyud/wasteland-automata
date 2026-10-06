// Lint: ESLint's and typescript-eslint's recommended rules everywhere, plus purity rules for the
// simulation (it must stay deterministic: no wall clock, no Math.random, no I/O, no engine-dependent maths).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = Object.fromEntries(
  ['process', 'console', 'URL', 'Buffer', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'performance'].map((g) => [g, 'readonly']),
);

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'apps/dashboard/.next/**', 'apps/dashboard/next-env.d.ts', 'contracts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: nodeGlobals },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'process', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'fetch', 'crypto', 'globalThis', 'Intl'].map(
          (name) => ({ name, message: 'packages/sim is deterministic: time comes from the tick counter and there is no I/O.' }),
        ),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng.' },
        ...['pow', 'hypot', 'exp', 'log', 'sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'cbrt'].map((property) => ({
          object: 'Math',
          property,
          message: 'Transcendental Math can differ across engines; use + - * / and Math.sqrt.',
        })),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: 'Use multiplication; ** can differ from x*x.' },
        { selector: "CallExpression[callee.property.name='localeCompare']", message: 'Locale-dependent.' },
      ],
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', 'fs', 'path', 'os', 'http', 'https', 'net', 'child_process', 'crypto'], message: 'No I/O in packages/sim.' }] }],
    },
  },
  {
    // The published reference client is deliberately loose about JSON shapes (type J = any).
    files: ['packages/client/agent.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
