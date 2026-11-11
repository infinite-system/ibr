// Tests for ibr-code-review-new-code.mjs, each with both outcomes: what must be listed,
// and what must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readScope } from './ibr-code-review-new-code.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'ibr-code-review-new-code.mjs');

const PROFILE = [
  '# Query engine review profile',
  '',
  '## How to run',
  '',
  '- Code: `not/scope/` (another section must not be read as Scope)',
  '',
  '## Scope',
  '',
  '- Contracts: `docs/query-engine.invariants.md`',
  '- Code: `api/query/`, `shared/query/`',
  '',
  '## Substrate',
  '',
  '- Code: `not/scope/` (a later section must not be read as Scope)',
].join('\n');

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'new-code-'));
  const git = (...gitArguments) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...gitArguments], {
      cwd: root,
      encoding: 'utf8',
    });
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  git('init', '-q');
  write('docs/query-engine.ibr-code-review.md', PROFILE);
  write('docs/query-engine.invariants.md', '# contract\n');
  write('api/query/engine.ts', 'export const engine = 1;\n');
  write('api/query/old.ts', 'export const old = 1;\n');
  write('api/other/untouched.ts', 'export const untouched = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  const first = git('rev-parse', '--short', 'HEAD').trim();
  const round = join(root, 'tmp-round');
  mkdirSync(round);
  writeFileSync(join(round, 'ibr-code-review-score.json'), JSON.stringify({ commit: first }));
  return { root, git, write, round, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(root, extraArguments) {
  try {
    const stdout = execFileSync('node', [CLI, '--profile', join(root, 'docs/query-engine.ibr-code-review.md'), '--root', root, ...extraArguments], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

test('Scope is read from its own section only, paths in backticks', () => {
  assert.deepEqual(readScope(PROFILE), {
    contracts: ['docs/query-engine.invariants.md'],
    code: ['api/query/', 'shared/query/'],
  });
  assert.deepEqual(readScope('# no scope here\n'), { contracts: [], code: [] });
});

// local-invariant: new-code — If a stored round follows a profile, then the code in scope that changed since the previous round's commit is listed, and code outside the scope that annotates the scope's contracts is listed too; nothing else is.
test('code in scope that changed since the last round is listed; code outside scope is not', () => {
  const { root, git, write, round, cleanup } = repository();
  const quiet = run(root, ['--previous', round]);
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.match(quiet.stdout, /## New or changed in scope since \w+\nNone\./);

  write('api/query/engine.ts', 'export const engine = 2;\n');
  write('shared/query/filters.ts', 'export const filters = [];\n');
  unlinkSync(join(root, 'api/query/old.ts'));
  write('api/other/untouched.ts', 'export const untouched = 2;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'second');
  const changed = run(root, ['--previous', round]);
  assert.equal(changed.code, 0, changed.stderr);
  assert.match(changed.stdout, /- changed: api\/query\/engine\.ts/);
  assert.match(changed.stdout, /- added: shared\/query\/filters\.ts/);
  assert.match(changed.stdout, /- deleted: api\/query\/old\.ts/);
  assert.doesNotMatch(changed.stdout, /untouched\.ts/);
  cleanup();
});

test('code outside the scope that annotates its contracts is listed; other code is not', () => {
  const { root, git, write, round, cleanup } = repository();
  write('api/reports/totals.ts', '// invariant: Totals match the rows (docs/query-engine.invariants.md)\n');
  write('api/reports/unrelated.ts', '// invariant: Something else (docs/other.invariants.md)\n');
  write('api/query/inside.ts', '// invariant: Inside rule (docs/query-engine.invariants.md)\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'outside');
  const result = run(root, ['--previous', round]);
  assert.equal(result.code, 0, result.stderr);
  const outsideSection = result.stdout.split("## Code outside the profile's scope that annotates its contracts")[1];
  assert.match(outsideSection, /- api\/reports\/totals\.ts \(annotates docs\/query-engine\.invariants\.md\)/);
  assert.doesNotMatch(outsideSection, /unrelated\.ts|inside\.ts/);
  cleanup();
});

test('the first round treats the whole scope as new; bad input is refused', () => {
  const { root, round, cleanup } = repository();
  const first = run(root, []);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /First round: the whole scope is new \(api\/query\/, shared\/query\/\)/);
  writeFileSync(join(root, 'docs/query-engine.ibr-code-review.md'), '# no scope\n');
  const noScope = run(root, []);
  assert.equal(noScope.code, 1);
  assert.match(noScope.stderr, /Scope needs a `- Contracts:` and a `- Code:` line/);
  writeFileSync(join(round, 'ibr-code-review-score.json'), JSON.stringify({}));
  writeFileSync(join(root, 'docs/query-engine.ibr-code-review.md'), PROFILE);
  const noCommit = run(root, ['--previous', round]);
  assert.equal(noCommit.code, 1);
  assert.match(noCommit.stderr, /no commit recorded/);
  cleanup();
});
