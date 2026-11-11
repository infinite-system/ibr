// Tests for ibr-code-invariants-check.mjs — run with:  node --test scripts/ibr-code-invariants-check.test.mjs
//
// Black-box: each test spawns the real CLI against fixtures built in a temp dir and
// asserts stdout/stderr/exit code. The suite is the executable spec of the contract
// schema; if you change the schema, change these tests in the same commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  'ibr-code-invariants-check.mjs',
);

function run(args, cwd) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'invcheck-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const record = (name, fields = {}) => {
  const f = {
    Invariant: 'If conditions hold, then behavior follows.',
    Scope: 'The test scope.',
    Mechanism: 'The bridge.',
    Evidence: 'A test.',
    'Rules out': 'The negative boundary.',
    Verification: 'Run the suite.',
    Status: 'provisional',
    'Last refined': '2026-07-19',
    ...fields,
  };
  const body = Object.entries(f)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `**${k}:** ${v}`)
    .join('\n\n');
  return `### ${name}\n\n${body}\n`;
};

// a chosen record is chosen FOR something: fixtures give each one a Goal unless the
// test sets its own (or passes Goal: null to omit it)
const withGoal = (chosenRecord) =>
  /\*\*Goal:\*\*/.test(chosenRecord)
    ? chosenRecord
    : chosenRecord.replace(/\n\*\*Invariant:\*\*/, '\n**Goal:** The fixture intent.\n\n**Invariant:**');
const contract = (
  realityRecords,
  chosenRecords,
  { chosenHeading = '## Chosen invariants' } = {},
) =>
  `# Test contract\n\n## Reality-based invariants\n\n${realityRecords.join('\n')}\n${chosenHeading}\n\n${chosenRecords.map(withGoal).join('\n')}`;

const contractWithGenerator = (realityRecords, chosenRecords, componentLinks) =>
  contract(realityRecords, chosenRecords).replace(
    '## Reality-based invariants',
    [
      '## Generator',
      '',
      'This record states how the test gears combine.',
      '',
      record('The test gears form one mechanism', {
        Goal: 'One checked mechanism.',
        Scope: 'The fixture contract.',
        Components: componentLinks,
        Mechanism: 'The linked records combine under one goal.',
        'Rules out':
          'A linked gear can disappear without changing the mechanism.',
      }),
      '## Reality-based invariants',
    ].join('\n'),
  );

const testGeneratorHeader = ({
  domainClaims,
  impossibleClaims,
  contractPointers = [],
  described = 'The fixture keeps each claim beside the test that proves it.',
}) =>
  [
    '/*',
    '=== GENERATOR ===',
    'Goal: prove the local mechanism from this file.',
    ...contractPointers,
    ...domainClaims.map(
      ({ symbol, claim }) => `// domain-invariant: ${symbol} — ${claim}`,
    ),
    ...impossibleClaims.map((claim) => `Impossible if true: ${claim}`),
    '',
    '=== GENERATOR-DESCRIBED ===',
    described,
    '*/',
  ].join('\n');

// ---------- schema validation ----------

test('canonical contract passes', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract([record('The Constraint')], [record('The Discipline')]),
  );
  const r = run([p]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /PASS .*1 reality, 1 chosen invariants/);
  cleanup();
});

test("legacy '## Designed invariants' heading accepted", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract([record('A')], [record('B')], {
      chosenHeading: '## Designed invariants',
    }),
  );
  assert.equal(run([p]).code, 0);
  cleanup();
});

test('optional fields accepted; Components and Generates tolerated', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract(
      [
        record('A', {
          'Renegotiable at': 'consumer contract',
          Components: 'x — part. y — part.',
          Generates: 'guards',
          'Rejected alternatives':
            'ports for isolation — cookie jars key on hostname.',
          'Open question': 'does this hold under ipv6?',
        }),
      ],
      [record('B', { Generates: 'discipline' })],
    ),
  );
  const r = run([p]);
  assert.equal(r.code, 0);
  cleanup();
});

test('missing required fields, bad status, bad date each named', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract(
      [
        record('Broken', {
          Scope: null,
          Mechanism: null,
          Status: 'speculative',
          'Last refined': 'July 19',
        }),
      ],
      [record('Fine')],
    ),
  );
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Broken': missing or empty Scope/);
  assert.match(r.stderr, /'Broken': missing or empty Mechanism/);
  assert.match(r.stderr, /'Broken': invalid Status/);
  assert.match(r.stderr, /'Broken': Last refined must match YYYY-MM-DD/);
  cleanup();
});

test("'Renegotiable at' on a chosen record is an error", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract([record('A')], [record('B', { 'Renegotiable at': 'elsewhere' })]),
  );
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /'B': 'Renegotiable at' is only valid on reality records/,
  );
  cleanup();
});

test('unknown field is flagged', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract([record('A', { Vibe: 'immaculate' })], [record('B')]),
  );
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'A': unknown field 'Vibe'/);
  cleanup();
});

test('duplicate names fail', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(p, contract([record('Same Name')], [record('Same Name')]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Same Name': duplicate invariant name/);
  cleanup();
});

test('legacy numbered heading passes with a migration note', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(p, contract([record('ZZ-R001 — Old Style')], [record('B')]));
  const r = run([p]);
  assert.equal(r.code, 0);
  assert.match(
    r.stdout,
    /numbered heading — canonical style is an unnumbered name/,
  );
  cleanup();
});

test('legacy ID letter in the wrong section is an error', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(p, contract([record('ZZ-C001 — Misfiled')], [record('B')]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /chosen-lettered ID in the reality section/);
  cleanup();
});

test('empty category notes but passes; empty contract fails', () => {
  const { dir, cleanup } = tmp();
  const p1 = join(dir, 'young.invariants.md');
  writeFileSync(p1, contract([record('A')], []));
  const r1 = run([p1]);
  assert.equal(r1.code, 0);
  assert.match(r1.stdout, /one category is empty — fine while bootstrapping/);
  const p2 = join(dir, 'empty.invariants.md');
  writeFileSync(p2, contract([], []));
  assert.equal(run([p2]).code, 1);
  cleanup();
});

// ---------- discovery / --all ----------

test('--all discovers nested contracts, skips local formats and node_modules', () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, 'sub/deep'), { recursive: true });
  mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
  writeFileSync(
    join(dir, 'sub/deep/a.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'local.invariants.md'),
    '# Narrative style\n\n## My Named Invariant\n\nProse.\n',
  );
  writeFileSync(join(dir, 'node_modules/pkg/x.invariants.md'), 'junk');
  const r = run(['--all', dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /PASS .*a\.invariants\.md/);
  assert.match(r.stdout, /SKIP .*local\.invariants\.md.*local format/);
  assert.doesNotMatch(r.stdout + r.stderr, /node_modules/);
  const strict = run(['--all', dir, '--strict']);
  assert.equal(strict.code, 1);
  assert.match(strict.stderr, /FAIL .*local\.invariants\.md: non-canonical/);
  cleanup();
});

test('--all and --refs skip the directories listed in .invariantsignore', () => {
  const { dir, cleanup } = tmp();
  const archivedDirectory = join(dir, 'archive/old-scripts');
  mkdirSync(archivedDirectory, { recursive: true });
  writeFileSync(join(dir, '.invariantsignore'), '# archived scripts\n./archive/old-scripts/\n');
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  writeFileSync(
    join(archivedDirectory, 'stale.invariants.md'),
    'not a valid contract',
  );
  writeFileSync(
    join(archivedDirectory, 'stale.js'),
    '// invariant: Ghost (missing.invariants.md)\n',
  );
  const result = run(['--all', '--refs', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /stale|Ghost/);
  cleanup();
});

test('without .invariantsignore no project directory is skipped', () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, 'archive/old-scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'archive/old-scripts/stale.js'),
    '// invariant: Ghost (missing.invariants.md)\n',
  );
  const result = run(['--refs', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /old-scripts\/stale\.js:1: contract not found/);
  cleanup();
});

test('gitignored paths are not scanned, and the same paths are scanned once not ignored', () => {
  const { dir, cleanup } = tmp();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  mkdirSync(join(dir, 'scratch'), { recursive: true });
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  writeFileSync(join(dir, 'scratch/notes.js'), '// invariant: Ghost (missing.invariants.md)\n');
  writeFileSync(join(dir, 'loose.js'), '// invariant: Ghost (missing.invariants.md)\n');
  writeFileSync(join(dir, '.gitignore'), 'scratch/\nloose.js\n');
  const ignored = run(['--all', '--refs', dir]);
  assert.equal(ignored.code, 0, ignored.stderr);
  assert.match(ignored.stdout, /note: 2 gitignored path\(s\) not scanned/);
  assert.doesNotMatch(ignored.stderr, /Ghost|missing\.invariants\.md/);
  rmSync(join(dir, '.gitignore'));
  const scanned = run(['--refs', dir]);
  assert.equal(scanned.code, 1);
  assert.match(scanned.stderr, /scratch\/notes\.js:1: contract not found/);
  assert.match(scanned.stderr, /loose\.js:1: contract not found/);
  assert.doesNotMatch(scanned.stdout, /gitignored path/);
  cleanup();
});

test('markdown past the scan cap is skipped loudly by the link pass; under it, it is read', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  const brokenLink = '[Ghost](demo.invariants.md#ghost-record)\n';
  writeFileSync(join(dir, 'transcript.md'), brokenLink + 'x'.repeat(2_100_000) + '\n');
  const large = run(['--refs', dir]);
  assert.equal(large.code, 0, large.stderr);
  assert.match(large.stdout, /note: file exceeds 2000000 bytes .*transcript\.md/);
  writeFileSync(join(dir, 'transcript.md'), brokenLink);
  const small = run(['--refs', dir]);
  assert.equal(small.code, 1);
  assert.match(small.stderr, /transcript\.md:1: .*ghost-record/);
  cleanup();
});

// ---------- --refs annotation drift ----------

test('--refs resolves valid annotations, fails orphans, harvests local headings', () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, 'sub'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'sub/demo.invariants.md'),
    contract([record('Real Rule')], [record('Held Discipline')]),
  );
  writeFileSync(
    join(dir, 'scripts/tool.invariants.md'),
    '# Tool — Invariants\n\n## Identity Must Reflect Reality _(the master invariant)_\n\nProse.\n',
  );
  writeFileSync(
    join(dir, 'sub/guard.js'),
    [
      '// invariant: Real Rule (sub/demo.invariants.md)',
      '// invariant: Identity Must Reflect Reality (scripts/tool.invariants.md)',
      '// invariant: Ghost Rule (sub/demo.invariants.md)',
      '// invariant: Held Discipline (missing/gone.invariants.md)',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /2 annotation\(s\) resolved, .*2 problem\(s\)/);
  assert.match(
    r.stderr,
    /invariant 'Ghost Rule' not found in sub\/demo\.invariants\.md/,
  );
  assert.match(r.stderr, /contract not found: missing\/gone\.invariants\.md/);
  cleanup();
});

test('--refs rejects paths relative to the annotated file directory', () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(
    join(dir, 'sub/demo.invariants.md'),
    contract([record('Real Rule')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'sub/guard.js'),
    '// invariant: Real Rule (demo.invariants.md)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /0 annotation\(s\) resolved, .*1 problem\(s\)/);
  assert.match(
    r.stderr,
    /contract path must be root-relative: demo\.invariants\.md \(use sub\/demo\.invariants\.md\)/,
  );
  cleanup();
});

test('--refs reports canonical records with zero annotations as coverage info', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Annotated Rule')], [record('Never Referenced')]),
  );
  writeFileSync(
    join(dir, 'code.js'),
    '// invariant: Annotated Rule (demo.invariants.md)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0); // coverage is informational, not a failure
  assert.match(
    r.stdout,
    /coverage demo\.invariants\.md: no annotations reference: Never Referenced/,
  );
  assert.doesNotMatch(r.stdout, /no annotations reference:.*Annotated Rule/);
  cleanup();
});

test("--refs skips the checker's own test file", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'ibr-code-invariants-check.test.mjs'),
    '// invariant: Ghost (sub/none.invariants.md)\n',
  );
  writeFileSync(
    join(dir, 'SKILL.md'),
    '// invariant: Ghost Example (sub/none.invariants.md)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stderr, /Ghost/);
  cleanup();
});

test('--refs on a clean tree exits 0', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  writeFileSync(join(dir, 'code.js'), '// no annotations here\n');
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0);
  cleanup();
});

// ---------- generator references ----------

test('slug collision fails; punctuated name draws charset note', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract(
      [record('Routes cannot resend'), record('Routes, cannot resend!')],
      [record('B')],
    ),
  );
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /slug collision with 'Routes cannot resend'/);
  assert.match(r.stdout, /name contains punctuation/);
  cleanup();
});

test('generator: valid links resolve (inline, alias, reference-style), coverage reported', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract(
      [record('A non-ready route cannot transmit')],
      [record('Unknown usage remains unknown')],
    ),
  );
  writeFileSync(
    join(dir, 'demo.generator.md'),
    [
      '# How demo holds together',
      '',
      'Because [A non-ready route cannot transmit](demo.invariants.md#a-non-ready-route-cannot-transmit)',
      'and [the unknown-usage rule][uu] compose, telemetry is trustworthy.',
      '',
      '[uu]: demo.invariants.md#unknown-usage-remains-unknown',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /2 record link\(s\) resolved/);
  assert.doesNotMatch(r.stdout, /coverage demo\.generator\.md/); // all records woven
  cleanup();
});

test('generator: missing anchor, dead anchor, undefined ref key all fail', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'demo.generator.md'),
    [
      '[Rule one holds](demo.invariants.md)',
      '[Rule one holds](demo.invariants.md#rule-one-gone)',
      '[Rule one holds][nokey]',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /needs an anchor/);
  assert.match(
    r.stderr,
    /anchor '#rule-one-gone' does not resolve.*did you mean '#rule-one-holds'/,
  );
  assert.match(r.stderr, /undefined link reference \[nokey\]/);
  cleanup();
});

test('generator: verbatim-name text pointing at a different record fails; free alias passes', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract(
      [record('A non-ready route cannot transmit')],
      [record('Unknown usage remains unknown')],
    ),
  );
  writeFileSync(
    join(dir, 'demo.generator.md'),
    [
      '[A non-ready route cannot transmit](demo.invariants.md#unknown-usage-remains-unknown)',
      '[the transmit rule](demo.invariants.md#a-non-ready-route-cannot-transmit)',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /link text names 'A non-ready route cannot transmit'.*misleading reference/,
  );
  assert.doesNotMatch(r.stderr, /the transmit rule/);
  cleanup();
});

test('--refs reports italic record citations and accepts the linked form', () => {
  const { dir, cleanup } = tmp();
  const contractPath = join(dir, 'demo.invariants.md');
  writeFileSync(
    contractPath,
    contract(
      [record('Rule one holds')],
      [record('Rule two holds', { Mechanism: 'Stands on *Rule one holds*.' })],
    ),
  );

  const proseCitationRed = run(['--refs', dir]);
  assert.equal(proseCitationRed.code, 1);
  assert.match(
    proseCitationRed.stderr,
    /italic record citation 'Rule one holds' is prose, not a resolvable dependency/,
  );
  assert.match(
    proseCitationRed.stderr,
    /use \[Rule one holds\]\(#rule-one-holds\)/,
  );
  assert.match(
    proseCitationRed.stdout,
    /1 italic record citation\(s\), 1 problem\(s\)/,
  );

  writeFileSync(
    contractPath,
    contract(
      [record('Rule one holds')],
      [
        record('Rule two holds', {
          Mechanism: 'Stands on [Rule one holds](#rule-one-holds).',
        }),
      ],
    ),
  );
  const linkedCitationGreen = run(['--refs', dir]);
  assert.equal(linkedCitationGreen.code, 0, linkedCitationGreen.stderr);
  assert.match(
    linkedCitationGreen.stdout,
    /1 record link\(s\) resolved, 0 italic record citation\(s\), 0 problem\(s\)/,
  );
  cleanup();
});

// domain-invariant: checker-link-resolution — If a test header points to a contract record, then it uses the same anchor and misleading-label checks as every generator link.
test('test header contract links reject misleading record labels', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('Rule two holds')]),
  );
  writeFileSync(join(dir, 'Demo.ts'), 'class Demo {}\n');
  const domainClaim = 'If Demo runs, then its value stays bounded.';
  const impossible = 'Demo accepts a value outside the bound.';
  const testFile = (contractPointer) =>
    [
      testGeneratorHeader({
        domainClaims: [{ symbol: 'Demo', claim: domainClaim }],
        impossibleClaims: [impossible],
        contractPointers: [contractPointer],
      }),
      `// domain-invariant: Demo — ${domainClaim}`,
      `// rules-out: Demo — ${impossible}`,
      '// invariant: Rule two holds (demo.invariants.md)',
      'test("the record governs the bound", () => {});',
    ].join('\n');

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    testFile('[Rule one holds](demo.invariants.md#rule-two-holds)'),
  );
  const red = run(['--refs', dir]);
  assert.equal(red.code, 1);
  assert.match(red.stderr, /misleading reference/);

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    testFile('[Rule two holds](demo.invariants.md#rule-two-holds)'),
  );
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  cleanup();
});

test('links outside a Components field resolve but compose nothing, so no composition gap is reported', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('Rule two holds')]),
  );
  writeFileSync(
    join(dir, 'demo.generator.md'),
    '[rule one holds](demo.invariants.md#rule-one-holds)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0); // lowercase text of the SAME record is not misleading
  assert.doesNotMatch(r.stdout, /composition demo\.invariants\.md/);
  cleanup();
});

test('retired generator companions are noted, never gating, and absent ones are not noted', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('Rule two holds')]),
  );
  const clean = run(['--refs', dir]);
  assert.equal(clean.code, 0);
  assert.doesNotMatch(clean.stdout, /retired generator companion/);
  writeFileSync(
    join(dir, 'demo.lattice.md'),
    '[Rule one holds](demo.invariants.md#rule-one-holds)\n',
  );
  writeFileSync(join(dir, 'demo.generator.md'), '# Demo generator\n');
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0);
  assert.match(
    r.stdout,
    /note: retired generator companion: demo\.lattice\.md; fold what it carries into the records' fields/,
  );
  assert.match(
    r.stdout,
    /note: retired generator companion: demo\.generator\.md; fold what it carries into the records' fields/,
  );
  assert.match(r.stdout, /1 record link\(s\) resolved/);
  assert.doesNotMatch(r.stdout, /composition demo\.invariants\.md/);
  cleanup();
});

test('a legacy Generator section still parses, is noted, and its Components compose', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contractWithGenerator(
      [record('Rule one holds')],
      [record('Rule two holds')],
      '- [Rule one holds](demo.invariants.md#rule-one-holds) — first gear.\n' +
        '- [Rule two holds](demo.invariants.md#rule-two-holds) — second gear.',
    ),
  );
  const schema = run([p]);
  assert.equal(schema.code, 0);
  assert.match(schema.stdout, /1 reality, 1 chosen invariants \(\+1 in a legacy Generator section\)/);
  assert.match(schema.stdout, /legacy ## Generator section — move its record under ## Chosen invariants/);
  const refs = run(['--refs', dir]);
  assert.equal(refs.code, 0);
  assert.doesNotMatch(refs.stdout, /composition demo\.invariants\.md/);
  cleanup();
});

test('records with no composition need no Generator section and draw no note', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract([record('Rule one holds')], [record('Rule two holds')]),
  );
  const r = run([p]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /Generator/);
  cleanup();
});

// local-invariant: checker-rule-composition — If a record's Components link other records, then it composes them, wherever it lives; in such a contract, records nothing composes are reported, the composers themselves excepted.
test('an ordinary chosen record composes the records its Components link', () => {
  const { dir, cleanup } = tmp();
  const composing = record('The rules combine into one mechanism', {
    Components:
      '\n\n- [Rule one holds](#rule-one-holds) — the first part.\n- [Rule two holds](#rule-two-holds) — the second part.',
  });
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('Rule two holds'), composing, record('Rule three stands alone')]),
  );
  const r = run(['--all', '--refs', dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /composition demo\.invariants\.md: no record composes: Rule three stands alone$/m);
  assert.doesNotMatch(r.stdout, /no record composes: .*(Rule one holds|Rule two holds|The rules combine)/);
  cleanup();
});

test('links to generator and legacy companions resolve; dangling old names fail', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('Rule two holds')]),
  );
  writeFileSync(join(dir, 'demo.generator.md'), '# Demo generator\n');
  writeFileSync(
    join(dir, 'reflective.lattice.md'),
    '# Reflective legacy form\n',
  );
  writeFileSync(
    join(dir, 'README.md'),
    [
      '[generator](demo.generator.md)',
      '[legacy](reflective.lattice.md)',
      '[dangling old name](demo.lattice.md)',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /README\.md:3: companion not found: demo\.lattice\.md/,
  );
  assert.doesNotMatch(r.stderr, /demo\.generator\.md/);
  assert.doesNotMatch(r.stderr, /reflective\.lattice\.md/);
  cleanup();
});

// domain-invariant: checker-rule-a — If a test has a generator header, then the header is its first content and every local symbol resolves in the sibling source.
test('rule a: test headers are first and local symbols resolve in the sibling source', () => {
  const { dir, cleanup } = tmp();
  const claim = 'If Demo runs, then one local mechanism owns its value.';
  const impossible = 'A second local mechanism owns the same value.';
  const header = testGeneratorHeader({
    domainClaims: [{ symbol: 'Demo', claim }],
    impossibleClaims: [impossible],
  });
  writeFileSync(
    join(dir, 'Demo.ts'),
    'class Demo {}\n// class Missing exists only in a comment.\n',
  );
  const proofs = [
    `// domain-invariant: Demo — ${claim}`,
    'test("one local mechanism owns the value", () => {});',
    `// rules-out: Demo — ${impossible}`,
    'test("a second local mechanism is refused", () => {});',
  ].join('\n');
  writeFileSync(
    join(dir, 'Demo.test.ts'),
    `import { test } from 'bun:test';\n${header}\n${proofs}\n`,
  );
  const firstContentRed = run(['--refs', dir]);
  assert.equal(firstContentRed.code, 1);
  assert.match(
    firstContentRed.stderr,
    /invariant header must be the first content/,
  );

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    `${header.replaceAll('Demo', 'Missing')}\nimport { test } from 'bun:test';\n${proofs.replaceAll('Demo', 'Missing')}\n`,
  );
  const symbolRed = run(['--refs', dir]);
  assert.equal(symbolRed.code, 1);
  assert.match(
    symbolRed.stderr,
    /local-invariant symbol 'Missing' is not declared in sibling Demo\.ts/,
  );

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    `${header}\nimport { test } from 'bun:test';\n${proofs}\n`,
  );
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  cleanup();
});

// domain-invariant: checker-rule-b — If a header states a domain claim, contract component, or impossibility, then an annotated test proves it and no test invents another claim.
test('rule b: header claims and annotated tests cover each other in both directions', () => {
  const { dir, cleanup } = tmp();
  const domainClaim = 'If Demo runs, then its value stays bounded.';
  const impossible = 'Demo accepts a value outside the bound.';
  writeFileSync(join(dir, 'Demo.ts'), 'class Demo {}\n');
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('The bound holds')], []),
  );
  const header = testGeneratorHeader({
    domainClaims: [{ symbol: 'Demo', claim: domainClaim }],
    impossibleClaims: [impossible],
    contractPointers: ['[The bound holds](demo.invariants.md#the-bound-holds)'],
  });
  writeFileSync(
    join(dir, 'Demo.test.ts'),
    [
      header,
      "import { test } from 'bun:test';",
      `// domain-invariant: Demo — ${domainClaim}`,
      'test("the value stays bounded", () => {});',
    ].join('\n'),
  );
  const missingProofsRed = run(['--refs', dir]);
  assert.equal(missingProofsRed.code, 1);
  assert.match(
    missingProofsRed.stderr,
    /Rules out has no annotated negative test/,
  );
  assert.match(
    missingProofsRed.stderr,
    /header contract-record pointer has no annotated test/,
  );

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    [
      header,
      "import { test } from 'bun:test';",
      `// domain-invariant: Demo — ${domainClaim}`,
      `// rules-out: Demo — ${impossible}`,
      '// invariant: The bound holds (demo.invariants.md)',
      '/** This test plants the rejected out-of-bound value. */',
      'test("the bound refuses its impossible state", () => {});',
      '// domain-invariant: Demo — A claim missing from the header.',
      'test("an unexplained assertion", () => {});',
    ].join('\n'),
  );
  const orphanClaimRed = run(['--refs', dir]);
  assert.equal(orphanClaimRed.code, 1);
  assert.match(orphanClaimRed.stderr, /annotated test claim is absent/);

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    [
      header,
      "import { test } from 'bun:test';",
      `// domain-invariant: Demo — ${domainClaim}`,
      `// rules-out: Demo — ${impossible}`,
      '// invariant: The bound holds (demo.invariants.md)',
      '/** This test plants the rejected out-of-bound value. */',
      'test("the bound refuses its impossible state", () => {});',
    ].join('\n'),
  );
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  cleanup();
});

// domain-invariant: checker-impossibility-binding — If a header states an impossibility, then one impossible-if-true annotation repeats its symbol and text exactly.
test('rules-out annotations bind exact header impossibilities', () => {
  const { dir, cleanup } = tmp();
  const domainClaim = 'If Demo runs, then its value stays bounded.';
  const impossible = 'Demo accepts a value outside the bound.';
  const header = testGeneratorHeader({
    domainClaims: [{ symbol: 'Demo', claim: domainClaim }],
    impossibleClaims: [impossible],
  });
  writeFileSync(join(dir, 'Demo.ts'), 'class Demo {}\n');
  const domainProof = [
    `// domain-invariant: Demo — ${domainClaim}`,
    'test("the value stays bounded", () => {});',
  ].join('\n');

  writeFileSync(join(dir, 'Demo.test.ts'), `${header}\n${domainProof}\n`);
  const missingRed = run(['--refs', dir]);
  assert.equal(missingRed.code, 1);
  assert.match(
    missingRed.stderr,
    /Rules out has no annotated negative test/,
  );

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    [
      header,
      domainProof,
      `// rules-out: Demo — ${impossible} Changed.`,
      'test("the impossible state is refused", () => {});',
    ].join('\n'),
  );
  const exactTextRed = run(['--refs', dir]);
  assert.equal(exactTextRed.code, 1);
  assert.match(
    exactTextRed.stderr,
    /annotated impossibility is absent from the generator header/,
  );

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    [
      header,
      domainProof,
      `// rules-out: Demo — ${impossible}`,
      'test("the impossible state is refused", () => {});',
    ].join('\n'),
  );
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  cleanup();
});

// domain-invariant: checker-cross-label-refusal — If an impossibility uses a domain-invariant annotation, then the checker refuses the inverted label.
test('domain-invariant annotations cannot prove impossibilities', () => {
  const { dir, cleanup } = tmp();
  const domainClaim = 'If Demo runs, then its value stays bounded.';
  const impossible = 'Demo accepts a value outside the bound.';
  const header = testGeneratorHeader({
    domainClaims: [{ symbol: 'Demo', claim: domainClaim }],
    impossibleClaims: [impossible],
  });
  writeFileSync(join(dir, 'Demo.ts'), 'class Demo {}\n');
  const fixture = (impossibleAnnotation) =>
    [
      header,
      `// domain-invariant: Demo — ${domainClaim}`,
      impossibleAnnotation,
      'test("the bound refuses its impossible state", () => {});',
    ].join('\n');

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    fixture(`// domain-invariant: Demo — ${impossible}`),
  );
  const red = run(['--refs', dir]);
  assert.equal(red.code, 1);
  assert.match(red.stderr, /impossibility labeled as an invariant/);

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    [
      header,
      `// domain-invariant: Demo — ${domainClaim}`,
      `// rules-out: Demo — ${domainClaim}`,
      `// rules-out: Demo — ${impossible}`,
      'test("the bound refuses its impossible state", () => {});',
    ].join('\n'),
  );
  const inverseRed = run(['--refs', dir]);
  assert.equal(inverseRed.code, 1);
  assert.match(inverseRed.stderr, /invariant labeled as an impossibility/);

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    fixture(`// rules-out: Demo — ${impossible}`),
  );
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  cleanup();
});

// domain-invariant: checker-rule-c — If source carries a domain tripwire, then its sibling test header declares that symbol.
test('rule c: source tripwires resolve to sibling test-header claims', () => {
  const { dir, cleanup } = tmp();
  const otherClaim = 'If Other runs, then it stays local.';
  const demoClaim = 'If Demo runs, then it stays local.';
  const impossible = 'The local mechanism is bypassed.';
  writeFileSync(
    join(dir, 'Demo.ts'),
    ['class Demo {}', 'class Other {}', '// domain-invariant: Demo'].join('\n'),
  );
  const headerFor = (symbol, claim) =>
    testGeneratorHeader({
      domainClaims: [{ symbol, claim }],
      impossibleClaims: [impossible],
    });
  const proofsFor = (symbol, claim) =>
    [
      `// domain-invariant: ${symbol} — ${claim}`,
      `// rules-out: ${symbol} — ${impossible}`,
      'test("the local mechanism cannot be bypassed", () => {});',
    ].join('\n');
  writeFileSync(
    join(dir, 'Demo.test.ts'),
    `${headerFor('Other', otherClaim)}\n${proofsFor('Other', otherClaim)}\n`,
  );
  const red = run(['--refs', dir]);
  assert.equal(red.code, 1);
  assert.match(
    red.stderr,
    /source local-invariant 'Demo' has no header claim in Demo\.test\.ts/,
  );

  writeFileSync(
    join(dir, 'Demo.test.ts'),
    `${headerFor('Demo', demoClaim)}\n${proofsFor('Demo', demoClaim)}\n`,
  );
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  cleanup();
});

// domain-invariant: checker-rule-d — If retired source-coda or spec grammar appears, then the checker reports migration findings.
test('rule d: source generator codas and retired spec grammar are findings', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'Demo.ts'),
    'class Demo {}\n/* === GENERATOR ===\n=== SPEC ===\n// spec: old row\n*/\n',
  );
  const red = run(['--refs', dir]);
  assert.equal(red.code, 1);
  assert.match(
    red.stderr,
    /=== GENERATOR === belongs at the top of the sibling test file/,
  );
  assert.match(red.stderr, /=== SPEC === is retired/);
  assert.match(red.stderr, /\/\/ spec: rows are retired/);

  writeFileSync(join(dir, 'Demo.ts'), 'class Demo {}\n');
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  cleanup();
});

// domain-invariant: checker-rule-e — If a contract has a Generator section, then one full record composes resolving invariant records while the companion stays prose-only.
test('rule e: generator records resolve Components and companions stay prose-only', () => {
  const { dir, cleanup } = tmp();
  const contractPath = join(dir, 'demo.invariants.md');
  writeFileSync(
    contractPath,
    contract([record('Rule one holds')], [record('Rule two holds')]).replace(
      '## Reality-based invariants',
      '## Generator\n\nGoal: old short form.\n\n## Reality-based invariants',
    ),
  );
  const shortFormRed = run([contractPath]);
  assert.equal(shortFormRed.code, 1);
  assert.match(
    shortFormRed.stderr,
    /must carry exactly one full invariant record/,
  );

  writeFileSync(
    contractPath,
    contractWithGenerator(
      [record('Rule one holds')],
      [record('Rule two holds')],
      '- [Missing gear](demo.invariants.md#missing-gear) — absent.',
    ),
  );
  const componentRed = run([contractPath]);
  assert.equal(componentRed.code, 1);
  assert.match(
    componentRed.stderr,
    /component anchor '#missing-gear' does not resolve/,
  );

  writeFileSync(
    contractPath,
    contractWithGenerator(
      [record('Rule one holds')],
      [record('Rule two holds')],
      '- [Rule one holds](#rule-one-holds) — load-bearing gear.',
    ),
  );
  writeFileSync(
    join(dir, 'demo.generator.md'),
    '### Hidden record\n\n**Invariant:** If hidden, then it gates.\n',
  );
  const proseRed = run(['--refs', dir]);
  assert.equal(proseRed.code, 1);
  assert.match(proseRed.stderr, /generator companions are prose-only/);

  writeFileSync(
    join(dir, 'demo.generator.md'),
    '# Demo generator\n\nProse only.\n',
  );
  const green = run(['--all', '--refs', dir]);
  assert.equal(green.code, 0, green.stderr);
  assert.doesNotMatch(
    green.stdout,
    /composition demo\.invariants\.md: no record composes: .*Rule one holds/,
  );
  assert.match(
    green.stdout,
    /composition demo\.invariants\.md: no record composes: Rule two holds/,
  );
  cleanup();
});

// ---------- red-team regression fixes ----------

test('impossible calendar dates fail', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    contract([record('A', { 'Last refined': '2026-99-99' })], [record('B')]),
  );
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'A': Last refined must match YYYY-MM-DD/);
  cleanup();
});

test('section headings are not valid annotation targets in canonical contracts', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Real rule')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'pad.js'),
    '// invariant: Chosen invariants (demo.invariants.md)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Chosen invariants' not found/);
  cleanup();
});

test('coverage is file-qualified: same-named records in another contract are not masked', () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, 'a'));
  mkdirSync(join(dir, 'b'));
  writeFileSync(
    join(dir, 'a/one.invariants.md'),
    contract([record('Shared rule name')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'b/two.invariants.md'),
    contract([record('Shared rule name')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'guard.js'),
    '// invariant: Shared rule name (a/one.invariants.md)\n',
  );
  const r = run(['--refs', dir]);
  assert.match(
    r.stdout,
    /^coverage b\/two\.invariants\.md:.*Shared rule name/m,
  );
  assert.doesNotMatch(
    r.stdout,
    /^coverage a\/one\.invariants\.md:.*Shared rule name/m,
  );
  cleanup();
});

test('Enforcement: review-time exempts a record from coverage', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract(
      [record('Code rule')],
      [
        record('Discipline rule', {
          Enforcement: 'review-time — no code locus',
        }),
      ],
    ),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /coverage demo\.invariants\.md:.*Code rule/);
  assert.doesNotMatch(r.stdout, /no annotations reference:.*Discipline rule/);
  assert.match(
    r.stdout,
    /coverage-exempt demo\.invariants\.md \(Enforcement\): Discipline rule/,
  );
  cleanup();
});

test('near-miss filenames are flagged; paper-style titles are not', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  writeFileSync(join(dir, 'pb._invariants_.md'), '# looks like a contract');
  writeFileSync(join(dir, 'Invariant Theory - Paper.md'), '# a paper');
  const r = run(['--all', dir]);
  assert.match(r.stdout, /near-miss filename.*pb\._invariants_\.md/);
  assert.doesNotMatch(r.stdout, /Invariant Theory/);
  cleanup();
});

test('nested checkouts are skipped and noted', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  mkdirSync(join(dir, 'vendor/other/.git'), { recursive: true });
  writeFileSync(
    join(dir, 'vendor/other/x.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  const r = run(['--all', dir]);
  assert.match(r.stdout, /note: skipped nested checkout vendor\/other/);
  assert.doesNotMatch(r.stdout, /x\.invariants\.md/);
  cleanup();
});

// ---------- round-2 hardening: hostile inputs ----------

test('CRLF contracts parse identically; BOM tolerated', () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, 'demo.invariants.md');
  writeFileSync(
    p,
    '\ufeff' +
      contract([record('Real rule')], [record('B')]).replace(/\n/g, '\r\n'),
  );
  const r = run([p]);
  assert.equal(r.code, 0);
  writeFileSync(
    join(dir, 'g.js'),
    '// invariant: Real rule (demo.invariants.md)\n',
  );
  assert.equal(run(['--refs', dir]).code, 0);
  cleanup();
});

test('fenced code blocks are inert: annotations, headings, section dupes', () => {
  const { dir, cleanup } = tmp();
  const fenced =
    contract([record('Real rule')], [record('B')]) +
    [
      '',
      '```markdown',
      '### Fake record inside fence',
      '## Reality-based invariants',
      '```',
      '',
    ].join('\n');
  writeFileSync(join(dir, 'demo.invariants.md'), fenced);
  assert.equal(run([join(dir, 'demo.invariants.md')]).code, 0);
  writeFileSync(
    join(dir, 'README.md'),
    [
      '```js',
      '// invariant: Ghost (missing.invariants.md)',
      '```',
      '<!-- invariant: Old gone (missing.invariants.md) -->',
      'prose with \`invariant: Inline (missing.invariants.md)\` code span',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0, r.stderr);
  cleanup();
});

test('broken canonical contract does NOT fall back to loose harvest', () => {
  const { dir, cleanup } = tmp();
  // duplicate section heading (unfenced) -> bounds fail -> canonical-shaped but broken
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Real rule')], [record('B')]) +
      '\n## Reality-based invariants\n',
  );
  writeFileSync(
    join(dir, 'pad.js'),
    '// invariant: Chosen invariants (demo.invariants.md)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Chosen invariants' not found/);
  cleanup();
});

test('wrapped, nested-bracket, collapsed, titled-def, and angle-bracket links validate', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('Rule two holds')]),
  );
  writeFileSync(
    join(dir, 'demo.generator.md'),
    [
      '[Rule one',
      'holds](demo.invariants.md#rule-one-BROKEN)', // wrapped + broken anchor -> caught
      '[see [note] here](demo.invariants.md#also-broken)', // nested brackets -> caught
      '[Rule one holds][]', // collapsed ref
      '[Rule two holds](<demo.invariants.md#rule-two-holds>)', // angle-bracket target -> valid
      '',
      '[rule one holds]: demo.invariants.md#rule-one-broken-def "title here"',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /#rule-one-BROKEN' does not resolve/);
  assert.match(r.stderr, /#also-broken' does not resolve/);
  assert.match(r.stderr, /#rule-one-broken-def' does not resolve/); // collapsed ref resolved via titled def
  assert.doesNotMatch(r.stderr, /rule-two-holds/);
  cleanup();
});

test('percent-encoded and angle-bracket spaced contract paths resolve', () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, 'Domain Exploration'), { recursive: true });
  writeFileSync(
    join(dir, 'Domain Exploration/demo.invariants.md'),
    contract([record('Rule one holds')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'map.generator.md'),
    [
      '[Rule one holds](Domain%20Exploration/demo.invariants.md#rule-one-holds)',
      '[the rule](<Domain Exploration/demo.invariants.md#rule-one-holds>)',
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /2 record link\(s\) resolved/);
  cleanup();
});

test('non-Latin names slug GitHub-style, stay distinct, and anchors resolve', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract(
      [record('Кэш не выживает'), record('Логи не теряются')],
      [record('B')],
    ),
  );
  assert.equal(run([join(dir, 'demo.invariants.md')]).code, 0);
  writeFileSync(
    join(dir, 'demo.generator.md'),
    '[Кэш не выживает](demo.invariants.md#кэш-не-выживает)\n',
  );
  assert.equal(run(['--refs', dir]).code, 0);
  cleanup();
});

test('name with no sluggable characters is an error', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('→ ← ↑')], [record('B')]),
  );
  const r = run([join(dir, 'demo.invariants.md')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no sluggable characters/);
  cleanup();
});

test('multi-line field values are read: wrapped content and label-then-newline both work', () => {
  const { dir, cleanup } = tmp();
  const rec = [
    '### Real rule',
    '',
    '**Invariant:**',
    'If conditions hold, then behavior follows.',
    '',
    '**Scope:** The test',
    'scope continues on a second line.',
    '',
    '**Mechanism:** m',
    '',
    '**Evidence:** e',
    '',
    '**Impossible if true:** i',
    '',
    '**Verification:** v',
    '',
    '**Status:** provisional',
    '',
    '**Last refined:** 2026-07-19',
    '',
  ].join('\n');
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    `# T\n\n## Reality-based invariants\n\n${rec}\n## Chosen invariants\n\n${withGoal(record('B'))}`,
  );
  const r = run([join(dir, 'demo.invariants.md')]);
  assert.equal(r.code, 0, r.stderr);
  cleanup();
});

test('Seams is not a field: a way around a rule is a test, a finding, or Scope', () => {
  const { dir, cleanup } = tmp();
  const path = join(dir, 'demo.invariants.md');
  writeFileSync(path, contract([record('Rule one holds', { Seams: '- `writeRaw()` — closed by a test.' })], [record('Rule two holds')]));
  const result = run([path]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /'Rule one holds': unknown field 'Seams'/);
  cleanup();
});

test('a field spans paragraphs and lists; a bold-labelled bullet stays body', () => {
  const { dir, cleanup } = tmp();
  const rec = [
    '### Long rule',
    '',
    '**Invariant:** If conditions hold, then behavior follows.',
    '',
    '**Scope:** s',
    '',
    '**Mechanism:** The first paragraph of the mechanism.',
    '',
    'A second paragraph, after a blank line.',
    '',
    '- **Step one:** a bold-labelled bullet is body, not a field',
    '- **Mechanism note:** neither is this',
    '',
    '**Evidence:** e',
    '',
    '**Impossible if true:** i',
    '',
    '**Verification:** v',
    '',
    '**Status:** provisional',
    '',
    '**Last refined:** 2026-11-07',
    '',
  ].join('\n');
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    `# T\n\n## Reality-based invariants\n\n${rec}\n## Chosen invariants\n\n${withGoal(record('B'))}`,
  );
  const r = run([join(dir, 'demo.invariants.md')]);
  assert.equal(r.code, 0, r.stderr);
  cleanup();
});

test('a label repeated in one record fails instead of overwriting', () => {
  const { dir, cleanup } = tmp();
  const rec = [
    '### Twice rule',
    '',
    '**Invariant:** If conditions hold, then behavior follows.',
    '',
    '**Scope:** s',
    '',
    '**Mechanism:** first half',
    '',
    '**Mechanism:** second half',
    '',
    '**Evidence:** e',
    '',
    '**Impossible if true:** i',
    '',
    '**Verification:** v',
    '',
    '**Status:** provisional',
    '',
    '**Last refined:** 2026-11-07',
    '',
  ].join('\n');
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    `# T\n\n## Reality-based invariants\n\n${rec}\n## Chosen invariants\n\n${withGoal(record('B'))}`,
  );
  const r = run([join(dir, 'demo.invariants.md')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Twice rule': Mechanism appears twice \(line 13\)/);
  cleanup();
});

test('wrapped Enforcement field still exempts from coverage', () => {
  const { dir, cleanup } = tmp();
  const rec = record('Discipline rule').replace(
    '**Status:**',
    '**Enforcement:** review-time —\nno code locus, distributed discipline.\n\n**Status:**',
  );
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Code rule')], [rec]),
  );
  const r = run(['--refs', dir]);
  assert.doesNotMatch(r.stdout, /no annotations reference:.*Discipline rule/);
  cleanup();
});

test('malformed annotation-shaped comments are flagged, not silent', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Real rule')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'g.js'),
    [
      '// invariant: Real rule (demo.invariant.md)', // typo'd suffix
      '// invariant: Real rule [demo.invariants.md]', // wrong brackets
    ].join('\n'),
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.equal(
    (r.stderr.match(/annotation-shaped comment does not parse/g) || []).length,
    2,
  );
  cleanup();
});

test('skip notes print once in --refs; exclusions are exact-basename', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Real rule')], [record('B')]),
  );
  mkdirSync(join(dir, 'vendor/other/.git'), { recursive: true });
  writeFileSync(
    join(dir, 'UPSKILL.md'),
    '// invariant: Ghost (missing.invariants.md)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal((r.stdout.match(/skipped nested checkout/g) || []).length, 1);
  assert.match(r.stderr, /UPSKILL\.md:1: contract not found/); // UPSKILL.md is scanned now
  cleanup();
});

test('unknown flags exit 2; --version prints a version', () => {
  assert.equal(run(['--all', '--strick']).code, 2);
  const v = run(['--version']);
  assert.equal(v.code, 0);
  assert.equal(v.stdout.trim(), '6.0.0');
});

test('directory as PATH gives a directory-specific message', () => {
  const { dir, cleanup } = tmp();
  const r = run([dir]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is a directory/);
  cleanup();
});

// ---------- round-3 rotation regressions ----------

test('--all --refs in one invocation runs BOTH passes', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A', { Scope: null })], [record('B')]),
  );
  const r = run(['--all', '--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing or empty Scope/); // schema pass ran
  assert.match(r.stdout, /annotation\(s\) resolved/); // refs pass ran
  cleanup();
});

test('contract-targeting links in ANY md file are validated (not just .generator.md)', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('B')]),
  );
  writeFileSync(
    join(dir, 'README.md'),
    '[Rule one holds](demo.invariants.md#rule-one-GONE)\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /README\.md:1: anchor '#rule-one-GONE' does not resolve/,
  );
  cleanup();
});

test('pathless annotations in code files are flagged', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Real rule')], [record('B')]),
  );
  writeFileSync(join(dir, 'g.js'), '// invariant: Real rule\n');
  writeFileSync(
    join(dir, 'prose.md'),
    'the invariant: provisionality itself\n',
  ); // md prose exempt
  const r = run(['--refs', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /g\.js:1: pathless annotation/);
  assert.doesNotMatch(r.stderr, /prose\.md/);
  cleanup();
});

test('a rendered .svg showing invariant text draws a note, never a finding', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Real rule')], [record('B')]),
  );
  // A screenshot of a code editor: its <text> cells legitimately show annotation-shaped text
  // (pathless AND named forms) that must not be read as annotations.
  writeFileSync(
    join(dir, 'screenshot.svg'),
    '<svg><text>// invariant: Grap</text>' +
      '<text>// invariant: Real rule (demo.invariants.md)</text></svg>\n',
  );
  const r = run(['--refs', dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /note: rendered image contains 'invariant:' text/);
  assert.doesNotMatch(r.stderr, /screenshot\.svg/);
  cleanup();
});

test('Enforcement exemptions are visible and Mechanism-conflict is noted', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract(
      [record('Code rule')],
      [
        record('Discipline rule', {
          Enforcement: 'review-time — no locus',
          Mechanism: 'guard in src/guard.js enforces this',
        }),
      ],
    ),
  );
  const r = run(['--refs', dir]);
  assert.match(
    r.stdout,
    /coverage-exempt demo\.invariants\.md \(Enforcement\): Discipline rule/,
  );
  assert.match(
    r.stdout,
    /claims review-time Enforcement but its Mechanism names code/,
  );
  cleanup();
});

test('local-format contracts draw a loose-harvest note in --refs', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'old.invariants.md'),
    '# Old\n\n## Some Named Rule\n\nProse.\n',
  );
  const r = run(['--refs', dir]);
  assert.match(r.stdout, /note: local-format contract \(loose heading harvest/);
  cleanup();
});

test('--score emits JSON components as the last line; empty repo is scored:false', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract(
      [record('Real rule')],
      [record('B', { Enforcement: 'review-time — no locus' })],
    ),
  );
  writeFileSync(
    join(dir, 'g.js'),
    '// invariant: Real rule (demo.invariants.md)\n',
  );
  const r = run(['--score', dir]);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(j.contracts, 1);
  assert.equal(j.schema.records, 2);
  assert.equal(j.annotations, 1);
  assert.equal(j.exempt, 1);
  assert.equal(j.scored, true);
  const empty = run(['--score', mkdtempSync(join(tmpdir(), 'invempty-'))]);
  const je = JSON.parse(empty.stdout.trim().split('\n').pop());
  assert.equal(je.scored, false);
  cleanup();
});

// ---------- usage ----------

test('--help exits 0 and prints usage', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /usage:/);
  assert.match(r.stdout, /test headers, source tripwires, links/);
  assert.match(r.stdout, /record-membership coverage/);
});

test('--all and --refs print the resolved root', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('A')], [record('B')]),
  );
  assert.match(run(['--all', dir]).stdout, /^root /);
  assert.match(run(['--refs', dir]).stdout, /^root /);
  cleanup();
});

test('usage errors exit 2', () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(['/nonexistent/file.invariants.md']).code, 2);
});

// ---------- test headers: contract sections in the first block comment ----------

const headerFields = (fields) =>
  Object.entries(fields)
    .filter(([, value]) => value !== null)
    .flatMap(([label, value]) => [`**${label}:** ${value}`, ''])
    .join('\n');
const sectionHeaderLines = ({ generator = {}, reality = {}, chosen = {}, extraComponent = null } = {}) =>
  [
    '/*',
    '## Reality-based invariants',
    '',
    '### A value has one writer at a time',
    '',
    headerFields({
      Invariant: 'If two writers race, then the runtime serializes them.',
      Scope: 'Demo.ts on one thread.',
      Mechanism: 'One event loop.',
      'Rules out': 'Two writers interleave one value.',
      Status: 'established',
      'Last refined': '2026-11-09',
      ...reality,
    }),
    '## Chosen invariants',
    '',
    '### Demo owns its value end to end',
    '',
    headerFields({
      Goal: 'Every write to the value has one owner to reason about.',
      Invariant: 'If Demo runs, then its records hold together as one owner.',
      Scope: 'Demo.ts.',
      ...generator,
    }),
    '**Components:**',
    '',
    '- [Rule one holds](demo.invariants.md#rule-one-holds) — the contract rule this file realizes.',
    '- [A value has one writer at a time](#a-value-has-one-writer-at-a-time) — what the platform guarantees.',
    '- [Writes cannot bypass the owner](#writes-cannot-bypass-the-owner) — what this file chose.',
    ...(extraComponent ? [extraComponent] : []),
    '',
    '```text',
    '- [Ghost](#ghost) — a diagram line, inert inside the fence',
    '```',
    '',
    headerFields({
      Mechanism: 'One writer plus one path means one owner.',
      'Rules out': 'A write lands without Demo.',
      Status: 'provisional',
      'Last refined': '2026-11-09',
    }),
    '### Writes cannot bypass the owner',
    '',
    headerFields({
      Goal: 'One place to reason about every write.',
      Invariant: 'If code writes the value,\nthen it goes through Demo.',
      Scope: 'Demo.ts.',
      Mechanism: 'Demo holds the only setter.',
      'Rules out': '\n\n- A write bypasses Demo\n  through a second path.',
      Status: 'provisional',
      'Last refined': '2026-11-09',
      ...chosen,
    }),
    '*/',
  ];
const sectionProofLines = [
  '// local-invariant: Demo owns its value end to end',
  'test("one owner holds the value", () => {});',
  '// rules-out: Demo owns its value end to end — A write lands without Demo.',
  'test("an ownerless write is refused", () => {});',
  '// invariant: Rule one holds (demo.invariants.md)',
  'test("the contract rule holds here", () => {});',
  '// local-invariant: A value has one writer at a time',
  'test("racing writers are serialized", () => {});',
  '// rules-out: A value has one writer at a time — Two writers interleave one value.',
  'test("interleaving never happens", () => {});',
  '// local-invariant: Writes cannot bypass the owner',
  'test("writes go through Demo", () => {});',
  '// rules-out: Writes cannot bypass the owner — A write bypasses Demo through a second path.',
  'test("a bypassing write is refused", () => {});',
];
// the composition has no tripwire of its own: it is enforced through its parts
const sectionSource = [
  'class Demo {}',
  '// local-invariant: A value has one writer at a time',
  '// local-invariant: Writes cannot bypass the owner',
];
function sectionHeaderFixture({
  header = sectionHeaderLines(),
  proofs = sectionProofLines,
  source = sectionSource,
} = {}) {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract([record('Rule one holds')], [record('Rule two holds')]),
  );
  writeFileSync(join(dir, 'Demo.ts'), source.join('\n') + '\n');
  writeFileSync(
    join(dir, 'Demo.test.ts'),
    `${header.join('\n')}\nimport { test } from 'bun:test';\n${proofs.join('\n')}\n`,
  );
  return { dir, cleanup, result: run(['--refs', dir]) };
}
const without = (lines, ...dropped) => lines.filter((line) => !dropped.includes(line));

// local-invariant: checker-rule-test-header — If a test's first block comment holds contract sections, then every record is a full record proved by name, and every Impossible if true claim by its owner and joined text.
test('test header: contract sections of full records bind to name-identified proofs', () => {
  const { cleanup, result } = sectionHeaderFixture();
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /legacy Goal \+ GENERATOR-DESCRIBED/);
  assert.doesNotMatch(result.stdout + result.stderr, /Ghost|ghost/);
  assert.doesNotMatch(result.stdout, /no tripwire/);
  cleanup();
});

test('test header: an unproved record, wrapped impossibility, or contract link is a finding', () => {
  for (const [dropped, expected] of [
    ['// local-invariant: Writes cannot bypass the owner', /header record has no annotated test: Writes cannot bypass the owner/],
    [
      '// rules-out: Writes cannot bypass the owner — A write bypasses Demo through a second path.',
      /Rules out has no annotated negative test: Writes cannot bypass the owner — A write bypasses Demo through a second path\./,
    ],
    ['// invariant: Rule one holds (demo.invariants.md)', /header contract-record pointer has no annotated test: rule-one-holds/],
  ]) {
    const index = sectionProofLines.indexOf(dropped);
    const proofs = sectionProofLines.filter((_, line) => line !== index && line !== index + 1);
    const { cleanup, result } = sectionHeaderFixture({ proofs });
    assert.equal(result.code, 1);
    assert.match(result.stderr, expected);
    cleanup();
  }
});

test('test header: local records are full records; Evidence and Verification come from the tests', () => {
  for (const [header, expected] of [
    [sectionHeaderLines({ chosen: { 'Last refined': null } }), /'Writes cannot bypass the owner': missing or empty Last refined/],
    [sectionHeaderLines({ reality: { Scope: null } }), /'A value has one writer at a time': missing or empty Scope/],
    [sectionHeaderLines({ chosen: { Mechanism: null } }), /'Writes cannot bypass the owner': missing or empty Mechanism/],
  ]) {
    const { cleanup, result } = sectionHeaderFixture({ header });
    assert.equal(result.code, 1);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /missing or empty (Evidence|Verification)/);
    cleanup();
  }
});

// local-invariant: checker-rule-goal — If a record is chosen (a composition included), then it carries a Goal, and a reality record never does — in contracts and test headers alike.
test('Goal: required on chosen records and compositions, refused on reality records', () => {
  for (const [header, expected] of [
    [sectionHeaderLines({ chosen: { Goal: null } }), /'Writes cannot bypass the owner': chosen invariant needs Goal/],
    [sectionHeaderLines({ generator: { Goal: null } }), /'Demo owns its value end to end': chosen invariant needs Goal/],
    [sectionHeaderLines({ reality: { Goal: 'A wish.' } }), /'A value has one writer at a time': Goal is only valid on chosen records/],
  ]) {
    const { cleanup, result } = sectionHeaderFixture({ header });
    assert.equal(result.code, 1);
    assert.match(result.stderr, expected);
    cleanup();
  }
  const { dir, cleanup } = tmp();
  const path = join(dir, 'demo.invariants.md');
  writeFileSync(path, contract([record('Rule one holds')], [record('Rule two holds', { Goal: null })]).replace(/\*\*Goal:\*\* The fixture intent\.\n\n/, ''));
  const chosenRed = run([path]);
  assert.equal(chosenRed.code, 1);
  assert.match(chosenRed.stderr, /'Rule two holds': chosen invariant needs Goal/);
  writeFileSync(path, contract([record('Rule one holds', { Goal: 'A wish.' })], [record('Rule two holds')]));
  const realityRed = run([path]);
  assert.equal(realityRed.code, 1);
  assert.match(realityRed.stderr, /'Rule one holds': Goal is only valid on chosen records/);
  writeFileSync(path, contract([record('Rule one holds')], [record('Rule two holds')]));
  assert.equal(run([path]).code, 0);
  cleanup();
});

test('test header: a component anchor must name a record in the same header', () => {
  const header = sectionHeaderLines({
    extraComponent: '- [Nothing here](#no-such-record) — a dangling local anchor.',
  });
  const { cleanup, result } = sectionHeaderFixture({ header });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /component #no-such-record names no record in this header/);
  cleanup();
});

test('source tripwires name header records; an unknown name fails, a missing tripwire is noted', () => {
  const unknown = sectionHeaderFixture({ source: [...sectionSource, '// local-invariant: No such record'] });
  assert.equal(unknown.result.code, 1);
  assert.match(unknown.result.stderr, /Demo\.ts:4: source local-invariant 'No such record' has no header claim in Demo\.test\.ts/);
  unknown.cleanup();
  const untripwired = sectionHeaderFixture({
    source: without(sectionSource, '// local-invariant: Writes cannot bypass the owner'),
  });
  assert.equal(untripwired.result.code, 0, untripwired.result.stderr);
  assert.match(untripwired.result.stdout, /header records with no tripwire at an enforcement point: Writes cannot bypass the owner/);
  untripwired.cleanup();
});

test('test header: a bag of functions holds independent records with no composition', () => {
  const header = sectionHeaderLines();
  const compositionStart = header.indexOf('### Demo owns its value end to end');
  const compositionEnd = header.indexOf('### Writes cannot bypass the owner');
  const bag = [...header.slice(0, compositionStart), ...header.slice(compositionEnd)];
  const proofs = sectionProofLines.slice(6);
  const { cleanup, result } = sectionHeaderFixture({
    header: bag,
    proofs,
  });
  assert.equal(result.code, 0, result.stderr);
  cleanup();
});

test('legacy: domain-invariant aliases local-invariant, two-register headers are noted, symbol proofs stay legacy-only', () => {
  const { dir, cleanup } = tmp();
  const claim = 'If Demo runs, then one local mechanism owns its value.';
  const impossible = 'A second local mechanism owns the same value.';
  writeFileSync(join(dir, 'Demo.ts'), 'class Demo {}\n// domain-invariant: Demo\n');
  writeFileSync(
    join(dir, 'Demo.test.ts'),
    [
      testGeneratorHeader({ domainClaims: [{ symbol: 'Demo', claim }], impossibleClaims: [impossible] }),
      `// local-invariant: Demo — ${claim}`,
      'test("one owner", () => {});',
      `// rules-out: Demo — ${impossible}`,
      'test("second owner refused", () => {});',
    ].join('\n') + '\n',
  );
  const legacy = run(['--refs', dir]);
  assert.equal(legacy.code, 0, legacy.stderr);
  assert.match(legacy.stdout, /note: 1 test header\(s\) in the legacy Goal \+ GENERATOR-DESCRIBED form/);
  cleanup();

  const symbolProof = sectionHeaderFixture({
    proofs: [...sectionProofLines, '// local-invariant: Demo — a legacy symbol claim', 'test("legacy", () => {});'],
  });
  assert.equal(symbolProof.result.code, 1);
  assert.match(symbolProof.result.stderr, /annotations belong to the legacy header form; name the record/);
  symbolProof.cleanup();
});

// local-invariant: checker-rule-promotion — If a second file depends on a header record, then the checker says to promote it; a record in a header AND a contract is a half-done promotion; a finished promotion keeps every proof, negative tests included.
test('promotion: a second dependent triggers it, half-done fails, done keeps every proof', () => {
  const name = 'Writes cannot bypass the owner';
  const promotedRecord = record(name, {
    Goal: 'One place to reason about every write.',
    Invariant: 'If code writes the value, then it goes through Demo.',
    'Rules out': '\n\n- A write bypasses Demo\n  through a second path.',
  });
  const stage = ({ contractChosen, header, proofs, demoSource, otherSource }) => {
    const { dir, cleanup } = tmp();
    writeFileSync(
      join(dir, 'demo.invariants.md'),
      contract([record('Rule one holds')], [record('Rule two holds'), ...contractChosen]),
    );
    writeFileSync(join(dir, 'Demo.ts'), demoSource.join('\n') + '\n');
    writeFileSync(join(dir, 'Other.ts'), otherSource.join('\n') + '\n');
    writeFileSync(
      join(dir, 'Demo.test.ts'),
      `${header.join('\n')}\nimport { test } from 'bun:test';\n${proofs.join('\n')}\n`,
    );
    const result = run(['--refs', dir]);
    cleanup();
    return result;
  };

  // 1. the trigger: Other.ts depends on a record local to Demo.test.ts
  const triggered = stage({
    contractChosen: [],
    header: sectionHeaderLines(),
    proofs: sectionProofLines,
    demoSource: sectionSource,
    otherSource: ['export function other() {}', `// local-invariant: ${name}`],
  });
  assert.equal(triggered.code, 1);
  assert.match(
    triggered.stderr,
    /Other\.ts:2: source local-invariant 'Writes cannot bypass the owner' has no header claim in Other\.test\.ts — 'Writes cannot bypass the owner' is local to Demo\.test\.ts; .* time to promote it/,
  );

  // 2. half done: the record was copied into the contract but not removed from the header
  const halfDone = stage({
    contractChosen: [promotedRecord],
    header: sectionHeaderLines(),
    proofs: sectionProofLines,
    demoSource: sectionSource,
    otherSource: ['export function other() {}'],
  });
  assert.equal(halfDone.code, 1);
  assert.match(halfDone.stderr, /Demo\.test\.ts: 'Writes cannot bypass the owner' lives in two homes — this header and demo\.invariants\.md/);

  // 3. done: the header links the contract record; proofs and tripwires carry the path;
  //    the negative test keeps its impossible-if-true form and is checked against the contract
  const fullHeader = sectionHeaderLines();
  const promotedHeader = fullHeader
    .slice(0, fullHeader.indexOf('### Writes cannot bypass the owner'))
    .concat(['*/'])
    .map((line) =>
      line.startsWith('- [Writes cannot bypass the owner](#writes-cannot-bypass-the-owner)')
        ? '- [Writes cannot bypass the owner](demo.invariants.md#writes-cannot-bypass-the-owner) — what the contract chose.'
        : line,
    );
  const promotedProofs = sectionProofLines.map((line) =>
    line === `// local-invariant: ${name}` ? `// invariant: ${name} (demo.invariants.md)` : line,
  );
  const done = stage({
    contractChosen: [promotedRecord],
    header: promotedHeader,
    proofs: promotedProofs,
    demoSource: sectionSource.map((line) =>
      line === `// local-invariant: ${name}` ? `// invariant: ${name} (demo.invariants.md)` : line,
    ),
    otherSource: ['export function other() {}', `// invariant: ${name} (demo.invariants.md)`],
  });
  assert.equal(done.code, 0, done.stderr);

  // 3b. a negative test whose text no longer matches the promoted record is a finding
  const drifted = stage({
    contractChosen: [promotedRecord],
    header: promotedHeader,
    proofs: promotedProofs.map((line) =>
      line.startsWith(`// rules-out: ${name} —`)
        ? `// rules-out: ${name} — A write bypasses Demo somehow.`
        : line,
    ),
    demoSource: sectionSource.map((line) =>
      line === `// local-invariant: ${name}` ? `// invariant: ${name} (demo.invariants.md)` : line,
    ),
    otherSource: ['export function other() {}'],
  });
  assert.equal(drifted.code, 1);
  assert.match(drifted.stderr, /annotated impossibility is absent from demo\.invariants\.md: Writes cannot bypass the owner — A write bypasses Demo somehow\./);
});

// ---------- Stands on: the reasons a record stands on ----------

const standsOn = (...names) =>
  '\n\n' + names.map((name) => `- [${name}](#${name.toLowerCase().replaceAll(' ', '-')}) — why it matters here.`).join('\n');

// local-invariant: checker-rule-stands-on — If a record lists Stands on, then each link resolves, and a reality record stands only on reality records; renaming a record breaks every link to it until the links follow.
test('Stands on: a choice stands on reality; reality standing on a choice is refused', () => {
  const { dir, cleanup } = tmp();
  const path = join(dir, 'demo.invariants.md');
  const reality = [record('Copies drift apart'), record('Readers rebuild meaning', { 'Stands on': standsOn('Copies drift apart') })];
  writeFileSync(path, contract(reality, [record('State a rule once', { 'Stands on': standsOn('Copies drift apart') })]));
  assert.equal(run([path]).code, 0);
  const green = run(['--refs', dir]);
  assert.equal(green.code, 0, green.stderr);

  writeFileSync(
    path,
    contract([record('Copies drift apart', { 'Stands on': standsOn('State a rule once') })], [record('State a rule once')]),
  );
  const reversed = run(['--refs', dir]);
  assert.equal(reversed.code, 1);
  assert.match(reversed.stderr, /reality record 'Copies drift apart' stands on chosen record '#state-a-rule-once' — reality never stands on a choice/);
  cleanup();
});

test('Stands on: once a contract uses it, chosen records without it are noted; before, nothing is', () => {
  const { dir, cleanup } = tmp();
  const path = join(dir, 'demo.invariants.md');
  writeFileSync(path, contract([record('Copies drift apart')], [record('State a rule once'), record('Name things fully')]));
  assert.doesNotMatch(run(['--refs', dir]).stdout, /stands-on/);
  writeFileSync(
    path,
    contract([record('Copies drift apart')], [record('State a rule once', { 'Stands on': standsOn('Copies drift apart') }), record('Name things fully')]),
  );
  const noted = run(['--refs', dir]);
  assert.equal(noted.code, 0, noted.stderr);
  assert.match(noted.stdout, /note: stands-on demo\.invariants\.md: chosen records that stand on no record: Name things fully$/m);
  cleanup();
});

test('renaming a record breaks every link to it until the links follow', () => {
  const { dir, cleanup } = tmp();
  const path = join(dir, 'demo.invariants.md');
  const chosen = [record('State a rule once', { 'Stands on': standsOn('Copies drift apart') })];
  writeFileSync(path, contract([record('Copies of a rule drift apart')], chosen));
  const renamed = run(['--refs', dir]);
  assert.equal(renamed.code, 1);
  assert.match(renamed.stderr, /copies-drift-apart/);
  writeFileSync(path, contract([record('Copies drift apart')], chosen));
  assert.equal(run(['--refs', dir]).code, 0);
  cleanup();
});

test('--refs-for lists the records that stand on a record', () => {
  const { dir, cleanup } = tmp();
  writeFileSync(
    join(dir, 'demo.invariants.md'),
    contract(
      [record('Copies drift apart')],
      [record('State a rule once', { 'Stands on': standsOn('Copies drift apart') }), record('Name things fully')],
    ),
  );
  const result = run(['--refs-for', 'Copies drift apart', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /stood on by: 1\n\s+demo\.invariants\.md: State a rule once/);
  assert.doesNotMatch(result.stdout, /Name things fully/);
  const none = run(['--refs-for', 'State a rule once', dir]);
  assert.match(none.stdout, /stood on by: 0/);
  // a link with the right slug into the wrong contract is broken, not a dependent
  writeFileSync(
    join(dir, 'other.invariants.md'),
    contract([record('Readers rebuild meaning')], [
      record('Point elsewhere', { 'Stands on': '\n\n- [Copies drift apart](missing.invariants.md#copies-drift-apart) — wrong file.' }),
    ]),
  );
  const wrongFile = run(['--refs-for', 'Copies drift apart', dir]);
  assert.match(wrongFile.stdout, /stood on by: 1\n/);
  assert.doesNotMatch(wrongFile.stdout, /Point elsewhere/);
  cleanup();
});

test('a name over 12 words draws a note; 12 words or fewer draws none', () => {
  const { dir, cleanup } = tmp();
  const path = join(dir, 'demo.invariants.md');
  const twelve = 'A hover card reflects the language server type at the pointed symbol';
  const seventeen = 'A structural line edit is one atomic undo step that keeps the cursor on the moved line';
  writeFileSync(path, contract([record(twelve)], [record('Rule two holds')]));
  const fine = run([path]);
  assert.equal(fine.code, 0, fine.stderr);
  assert.doesNotMatch(fine.stdout, /words — names run 3 to 12 words/);
  writeFileSync(path, contract([record(seventeen)], [record('Rule two holds')]));
  const long = run([path]);
  assert.equal(long.code, 0, long.stderr);
  assert.match(long.stdout, /name has 17 words — names run 3 to 12 words; a longer one usually joins two claims/);
  cleanup();
});

test('the legacy label Impossible if true and keyword impossible-if-true still work as aliases', () => {
  const { dir, cleanup } = tmp();
  const path = join(dir, 'demo.invariants.md');
  const legacyLabel = record('Rule one holds').replace('**Rules out:**', '**Impossible if true:**');
  assert.match(legacyLabel, /\*\*Impossible if true:\*\*/);
  writeFileSync(path, contract([legacyLabel], [record('Rule two holds')]));
  const aliased = run([path]);
  assert.equal(aliased.code, 0, aliased.stderr);
  // both labels in one record are one field written twice
  writeFileSync(path, contract([record('Rule one holds', { 'Impossible if true': 'The old wording.' })], [record('Rule two holds')]));
  const both = run([path]);
  assert.equal(both.code, 1);
  assert.match(both.stderr, /'Rule one holds': Rules out appears twice/);
  // the legacy proof keyword still proves a header record's Rules out
  const proofs = sectionProofLines.map((line) => line.replace('// rules-out:', '// impossible-if-true:'));
  const { cleanup: cleanupHeader, result } = sectionHeaderFixture({ proofs });
  assert.equal(result.code, 0, result.stderr);
  cleanupHeader();
  cleanup();
});
