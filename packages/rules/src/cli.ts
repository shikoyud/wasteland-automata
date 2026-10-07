/**
 * Writes the agent guide and enforces its token cap. CI runs this; a guide over the cap fails the build.
 *   node src/cli.ts [--rules rules.json] --out dist/guide.md --max-tokens 4000
 * Tokens are counted with the cl100k_base encoding, which counts more tokens than newer
 * encodings for English text, so it is the cautious choice when players use many different models.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { encode } from 'gpt-tokenizer/encoding/cl100k_base';
import { generateGuide, rules as currentRules, type Rules } from './index.ts';

const fmt = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function main(): number {
  const { values } = parseArgs({
    options: {
      rules: { type: 'string' },
      out: { type: 'string' },
      'max-tokens': { type: 'string', default: '4000' },
    },
  });
  if (!values.out) {
    process.stderr.write('Usage: node src/cli.ts [--rules rules.json] --out guide.md [--max-tokens 4000]\n');
    return 2;
  }
  const maxTokens = Number(values['max-tokens']);
  const rules: Rules = values.rules ? (JSON.parse(readFileSync(values.rules, 'utf8')) as Rules) : currentRules;

  const guide = generateGuide(rules);
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, guide);

  const tokens = encode(guide).length;
  if (tokens > maxTokens) {
    process.stderr.write(
      `Guide for rules ${rules.rulesVersion} is ${fmt(tokens)} tokens; it exceeds the ${fmt(maxTokens)}-token cap. ` +
        'Shorten the text in rules.json or in the guide generator.\n',
    );
    return 1;
  }
  process.stdout.write(`Wrote ${values.out}: ${fmt(tokens)} tokens (cl100k_base), cap ${fmt(maxTokens)}.\n`);
  return 0;
}

process.exitCode = main();
