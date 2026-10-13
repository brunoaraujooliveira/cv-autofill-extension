import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const FORBIDDEN = /anthropic|claude|sonnet|\bopus\b|copilot/i;
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-e2e',
  'coverage',
  '.git',
  'test-results',
  'playwright-report',
]);
/** The provider is named where it is configured and where users are told which key to get. */
const ALLOWED_FILES = new Set([
  'src/background/llm/provider-config.ts',
  'README.md',
  'scripts/check-mentions.mjs',
  'package-lock.json',
]);
/** Personal working files that are never committed. */
const LOCAL_FILE = /\.local\.[a-z]+$|^architecture_plan\.json$/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) yield* walk(path);
    } else {
      yield path;
    }
  }
}

const offenders = [];
for await (const path of walk(ROOT)) {
  const file = relative(ROOT, path);
  if (ALLOWED_FILES.has(file) || LOCAL_FILE.test(file)) continue;
  if (FORBIDDEN.test(file)) {
    offenders.push(`${file} (file name)`);
    continue;
  }
  const lines = (await readFile(path, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    if (FORBIDDEN.test(line)) offenders.push(`${file}:${index + 1}`);
  });
}

if (offenders.length > 0) {
  console.error('Provider or tool names found outside the allowed files:');
  offenders.forEach((offender) => console.error(`  ${offender}`));
  process.exit(1);
}
console.log('No provider or tool names outside the allowed files.');
