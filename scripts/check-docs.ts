/**
 * Documentation-index integrity: required canonical pages exist, markdown
 * links from the indexed docs resolve, and every package.json `test:*`
 * script is named in docs/testing.md.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_CANONICAL_DOCS = [
  'docs/README.md',
  'docs/domain-model.md',
  'docs/architecture.md',
  'docs/persistence.md',
  'docs/canvas.md',
  'docs/subsystems.md',
  'docs/manufacturing.md',
  'docs/collaboration.md',
  'docs/testing.md',
  'docs/migrations.md',
] as const;

const INDEX_FILE = 'docs/README.md';
const TESTING_DOC = 'docs/testing.md';

const LINK_PATTERN = /\[[^\]]*\]\(([^)]+)\)/g;

function repoPath(...parts: string[]): string {
  return join(repoRoot, ...parts);
}

function extractHrefs(markdown: string): string[] {
  const hrefs: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(LINK_PATTERN.source, 'g');
  while ((match = pattern.exec(markdown)) !== null) {
    const raw = match[1]?.trim().split(/\s+/)[0] ?? '';
    const href = raw.replace(/^<|>$/g, '');
    if (!href || href.startsWith('#') || /^(https?:|mailto:)/i.test(href)) continue;
    const pathOnly = href.replace(/#.*$/, '');
    if (pathOnly.length > 0) hrefs.push(pathOnly);
  }
  return hrefs;
}

function documentationFiles(): string[] {
  const fromDocs = readdirSync(repoPath('docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`);
  return ['AGENTS.md', 'CONTRIBUTING.md', 'public/user-data/README.md', ...fromDocs];
}

function main(): void {
  const errors: string[] = [];

  for (const relative of REQUIRED_CANONICAL_DOCS) {
    if (!existsSync(repoPath(relative))) {
      errors.push(`missing required canonical document: ${relative}`);
    }
  }

  const indexPath = repoPath(INDEX_FILE);
  if (existsSync(indexPath)) {
    const indexMarkdown = readFileSync(indexPath, 'utf8');
    for (const relative of REQUIRED_CANONICAL_DOCS) {
      if (relative === INDEX_FILE) continue;
      const linked = extractHrefs(indexMarkdown).some((href) => {
        const target = resolve(dirname(indexPath), href.split('#')[0] ?? href);
        return target === repoPath(relative);
      });
      if (!linked) {
        errors.push(`${INDEX_FILE} does not link to ${relative}`);
      }
    }
  }

  for (const relative of documentationFiles()) {
    const absolute = repoPath(relative);
    if (!existsSync(absolute)) {
      errors.push(`missing documentation file: ${relative}`);
      continue;
    }
    const markdown = readFileSync(absolute, 'utf8');
    for (const href of extractHrefs(markdown)) {
      const target = resolve(dirname(absolute), href);
      if (!existsSync(target)) {
        errors.push(`broken link in ${relative}: ${href}`);
      }
    }
  }

  const pkg = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const testScriptNames = Object.keys(pkg.scripts ?? {}).filter((name) => name.startsWith('test:'));
  if (testScriptNames.length === 0) {
    errors.push('package.json has no test:* scripts');
  }
  const testingMarkdown = existsSync(repoPath(TESTING_DOC))
    ? readFileSync(repoPath(TESTING_DOC), 'utf8')
    : '';
  for (const name of testScriptNames) {
    if (!testingMarkdown.includes(name)) {
      errors.push(`${TESTING_DOC} does not mention package script ${name}`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exit(1);
  }

  console.log(
    `PASS docs check (${REQUIRED_CANONICAL_DOCS.length} canonical pages, ${testScriptNames.length} test:* scripts)`,
  );
}

main();
