// node:test reporter that turns each failing test into a GitHub Actions error annotation:
//   ::error file=<path>,line=<n>,col=<n>,title=Test failed: <test name>::<first line of the error>
// The annotation shows on the check run and the PR diff, so a red check names the failing test.
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

function filePath(file) {
  if (!file) return '';
  const abs = file.startsWith('file:') ? fileURLToPath(file) : file;
  return relative(process.cwd(), abs).split('\\').join('/');
}

function firstLine(error) {
  const e = error?.cause ?? error;
  const text = e?.message ?? String(e ?? 'failed');
  return text.split('\n').find((l) => l.trim()) ?? 'failed';
}

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const { name, file, line, column, details } = event.data;
    // Suites fail because a test inside them failed; that test has its own annotation.
    if (details?.type === 'suite' || details?.error?.failureType === 'subtestsFailed') continue;
    const props = [`file=${escapeProperty(filePath(file))}`, `line=${line ?? 1}`, `col=${column ?? 1}`, `title=${escapeProperty(`Test failed: ${name}`)}`];
    yield `::error ${props.join(',')}::${escapeData(firstLine(details?.error))}\n`;
  }
}
