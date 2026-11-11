// Tests for ibr-code-review-score.mjs. Each rule of the rubric has a test with both outcomes: the case
// where the rule applies and the case where it must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WEIGHTS, computeScore as computeAt, validate, effectiveSeverity, supportedMaximum, validateBeside, compareSubstrate } from './ibr-code-review-score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'ibr-code-review-score.mjs');

const COMMIT = 'a1b2c3d';
const computeScore = (scores, findings) => computeAt(scores, findings, COMMIT);
// evidence that supports level 5 for each parameter
const FULL_EVIDENCE = {
  verified: { command: 'npm test -- Route.test.ts', commit: COMMIT, result: 'pass', output: 'ibr-code-review-verification/route.txt' },
  unity: { home: 'src/Route.ts:88', searches: [{ query: 'isReady', where: 'src/' }], found: [] },
  proof: { parts: [{ part: 'Invariant', test: 'Route.test.ts: refuses a send' }] },
  falsifiable: { bug_report: 'Bytes arrived on a route still negotiating.' },
  observed: { comparisons: [{ input: 'q', expected: '3 rows', source: 'SQL from the declaration', actual: '3 rows', matched: true }] },
  anchored: { sites: ['src/Route.ts:88', 'src/Route.ts:120', 'src/Node.ts:40'] },
};
const entry = (level, evidence) => ({ level, evidence: evidence ?? null });
const record = (overrides = {}) => {
  const scores = {};
  for (const parameter of Object.keys(WEIGHTS)) scores[parameter] = entry(5, FULL_EVIDENCE[parameter]);
  return { contract: 'demo.invariants.md', verdict: 'upheld', scores: { ...scores, ...overrides } };
};
const finding = (overrides = {}) => ({
  id: 'F1',
  severity: 'fatal',
  reach: 'realistic',
  record: null,
  status: 'open',
  ...overrides,
});

function runCli(scores, findings, extraArguments = [], beside = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'review-round-'));
  for (const [name, content] of Object.entries(beside)) {
    writeFileSync(join(folder, `ibr-code-review-${name}.json`), JSON.stringify(content));
  }
  if (scores !== undefined) writeFileSync(join(folder, 'ibr-code-review-scores.json'), JSON.stringify(scores));
  if (findings !== undefined) writeFileSync(join(folder, 'ibr-code-review-findings.json'), JSON.stringify(findings));
  try {
    const stdout = execFileSync('node', [CLI, folder, '--commit', COMMIT, ...extraArguments], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '', folder };
  } catch (error) {
    return { code: error.status, stdout: error.stdout, stderr: error.stderr, folder };
  }
}

test('the weights add to 100 and match the table in SKILL.md', () => {
  assert.equal(Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
  const skill = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8');
  for (const [parameter, weight] of Object.entries(WEIGHTS)) {
    const name = parameter[0].toUpperCase() + parameter.slice(1);
    assert.match(skill, new RegExp(`\\| ${name} \\| ${weight}% \\|`), `table row for ${name}`);
    assert.match(skill, new RegExp(`### ${name} \\(${weight}%\\)`), `heading for ${name}`);
  }
});

test('a record score is the weighted average of its levels, as a percentage of 5', () => {
  const perfect = computeScore({ A: record() }, []);
  assert.equal(perfect.records.A.score, 100);
  // verified 25% at level 0: 75 of 100 weighted points remain
  const unverified = computeScore({ A: record({ verified: entry(0) }) }, []);
  assert.equal(unverified.records.A.score, 75);
});

test('a parameter left out is excluded and the other weights scale up', () => {
  // without observed (10%), a record at 5 everywhere else is still 100
  assert.equal(computeScore({ A: record({ observed: null }) }, []).records.A.score, 100);
  // proof 20 of the remaining 90 at level 0: (90 - 20) / 90, rounded
  const result = computeScore({ A: record({ observed: null, proof: entry(0) }) }, []);
  assert.equal(result.records.A.score, 77.8);
});

test('a level above 2 with no evidence counts as 2; full evidence stands; 2 or lower needs none', () => {
  for (const missing of [null, 'a sentence is not evidence', ['an', 'array']]) {
    const bare = computeScore({ A: record({ proof: entry(5, missing) }) }, []);
    assert.equal(bare.records.A.levels.proof, 2);
    assert.match(bare.adjustments.join('\n'), /'A': proof 5 → 2 \(no evidence\)/);
  }
  const backed = computeScore({ A: record() }, []);
  assert.equal(backed.records.A.score, 100);
  assert.equal(backed.adjustments.length, 0);
  const low = computeScore({ A: record({ proof: entry(2) }) }, []);
  assert.equal(low.records.A.levels.proof, 2);
  assert.equal(low.adjustments.length, 0);
});

// Each row: parameter, evidence, the highest level it supports, the reason printed.
const SUPPORT_CASES = [
  ['verified', FULL_EVIDENCE.verified, 5, null],
  ['verified', { ...FULL_EVIDENCE.verified, commit: 'ffff000' }, 4, /passed on ffff000, not on the commit under review \(a1b2c3d\)/],
  ['verified', { ...FULL_EVIDENCE.verified, commit: 'a1b2c3d4e5f6' }, 5, null],
  ['verified', { ...FULL_EVIDENCE.verified, result: 'fail' }, 3, /the Verification failed/],
  ['verified', { command: 'npm test' }, 2, /needs command, result/],
  ['unity', FULL_EVIDENCE.unity, 5, null],
  ['unity', { ...FULL_EVIDENCE.unity, found: [{ kind: 'duplication', where: 'src/Copy.ts:9' }] }, 4, /1 flaw/],
  ['unity', { ...FULL_EVIDENCE.unity, found: [{ kind: 'duplication', where: 'a:1' }, { kind: 'way-around', where: 'b:2' }] }, 3, /2 flaw/],
  ['unity', { ...FULL_EVIDENCE.unity, searches: [] }, 2, /at least one search/],
  ['unity', { ...FULL_EVIDENCE.unity, found: [{ kind: 'copy', where: 'a:1' }] }, 2, /kind \(duplication, over-unification or way-around\)/],
  ['proof', FULL_EVIDENCE.proof, 5, null],
  ['proof', { parts: [{ part: 'Invariant', test: 't' }, { part: 'Component 2', test: null }] }, 4, /1 part\(s\) without a test/],
  ['proof', { parts: [{ part: 'Invariant', test: 't' }, { part: 'A', test: null }, { part: 'B', test: '' }] }, 3, /2 part\(s\) without a test/],
  ['proof', { parts: [] }, 2, /needs parts/],
  ['falsifiable', FULL_EVIDENCE.falsifiable, 5, null],
  ['falsifiable', { bug_report: ' ' }, 2, /needs bug_report/],
  ['observed', FULL_EVIDENCE.observed, 5, null],
  ['observed', { comparisons: [{ ...FULL_EVIDENCE.observed.comparisons[0], matched: false }] }, 3, /did not match/],
  ['observed', { exercised: 'walked the workbench as admin' }, 3, /compared with no independent answer/],
  ['observed', { comparisons: [{ input: 'q', matched: true }] }, 2, /each comparison needs/],
  ['observed', {}, 2, /needs comparisons, or what was exercised/],
  ['anchored', FULL_EVIDENCE.anchored, 5, null],
  ['anchored', { sites: ['a:1', 'b:2'] }, 4, /2 annotated site/],
  ['anchored', { sites: ['a:1'] }, 3, /1 annotated site/],
  ['anchored', { sites: ['a:1'], covers_mechanism: true }, 5, null],
  ['anchored', { sites: [] }, 2, /0 annotated site/],
];

test('each parameter supports only the level its evidence shows', () => {
  for (const [parameter, evidence, expected, reason] of SUPPORT_CASES) {
    const result = supportedMaximum(parameter, evidence, COMMIT);
    assert.equal(result.maximum, expected, `${parameter} ${JSON.stringify(evidence)}`);
    if (reason) assert.match(result.reason, reason, parameter);
  }
});

test('the script lowers an unsupported level, prints why, and never raises a level', () => {
  const lowered = computeScore({ A: record({ unity: entry(5, { ...FULL_EVIDENCE.unity, found: [{ kind: 'over-unification', where: 'src/Route.ts:90' }] }) }) }, []);
  assert.equal(lowered.records.A.levels.unity, 4);
  assert.match(lowered.adjustments.join('\n'), /'A': unity 5 → 4 \(1 flaw\(s\) found\)/);
  // full evidence never lifts a level the reviewer set lower
  const modest = computeScore({ A: record({ anchored: entry(1, FULL_EVIDENCE.anchored) }) }, []);
  assert.equal(modest.records.A.levels.anchored, 1);
  assert.equal(modest.adjustments.length, 0);
});

test('an open fatal finding caps the overall score at 85; a closed or wrong one does not', () => {
  const scores = { A: record(), B: record() };
  const capped = computeScore(scores, [finding()]);
  assert.equal(capped.raw, 100);
  assert.equal(capped.overall, 85);
  assert.match(capped.adjustments.join('\n'), /capped at 85 by open fatal finding\(s\) \(F1\)/);
  for (const status of ['closed', 'wrong']) {
    const free = computeScore(scores, [finding({ status })]);
    assert.equal(free.overall, 100, status);
    assert.equal(free.openFatal, 0, status);
  }
  // the cap never raises a score already below it
  const low = computeScore({ A: record({ verified: entry(0), proof: entry(0) }) }, [finding()]);
  assert.equal(low.overall, low.raw);
});

test('each open scoping finding costs 2 points; flags cost nothing', () => {
  const scores = { A: record() };
  const two = computeScore(scores, [
    finding({ id: 'F2', severity: 'scoping' }),
    finding({ id: 'F3', severity: 'scoping' }),
  ]);
  assert.equal(two.overall, 96);
  assert.equal(two.openScoping, 2);
  const flags = computeScore(scores, [finding({ severity: 'flag' }), finding({ id: 'F9', severity: 'flag' })]);
  assert.equal(flags.overall, 100);
  assert.equal(flags.openFlags, 2);
});

test('a contrived finding counts one severity lower', () => {
  assert.equal(effectiveSeverity(finding({ reach: 'contrived' })), 'scoping');
  assert.equal(effectiveSeverity(finding({ severity: 'scoping', reach: 'contrived' })), 'flag');
  assert.equal(effectiveSeverity(finding({ severity: 'flag', reach: 'contrived' })), 'flag');
  assert.equal(effectiveSeverity(finding()), 'fatal');
  const scores = { A: record() };
  // contrived fatal: minus 2, no cap
  assert.equal(computeScore(scores, [finding({ reach: 'contrived' })]).overall, 98);
  // contrived scoping: nothing
  assert.equal(computeScore(scores, [finding({ severity: 'scoping', reach: 'contrived' })]).overall, 100);
});

test('an open finding caps the Proof of the record it names, and only that record', () => {
  const scores = { A: record(), B: record() };
  const fatal = computeScore(scores, [finding({ record: 'A' })]);
  assert.equal(fatal.records.A.levels.proof, 2);
  assert.equal(fatal.records.B.levels.proof, 5);
  const scoping = computeScore(scores, [finding({ severity: 'scoping', record: 'A' })]);
  assert.equal(scoping.records.A.levels.proof, 3);
  // a finding with no record lowers no record, but still counts overall
  const unrecorded = computeScore(scores, [finding()]);
  assert.equal(unrecorded.records.A.levels.proof, 5);
  assert.equal(unrecorded.overall, 85);
  // a closed finding caps nothing
  assert.equal(computeScore(scores, [finding({ record: 'A', status: 'closed' })]).records.A.levels.proof, 5);
});

test('malformed input is refused with the reason, and well-formed input is accepted', () => {
  assert.deepEqual(validate({ A: record() }, []), []);
  const cases = [
    [{ A: record({ proof: null }) }, [], /'A': proof cannot be left out/],
    [{ A: record({ proof: entry(6) }) }, [], /'A': proof level must be a whole number from 0 to 5/],
    [{ A: record({ proof: entry(2.5) }) }, [], /'A': proof level must be a whole number/],
    [{ A: { scores: { verified: entry(5) } } }, [], /'A': missing parameter proof/],
    [{ A: record({ fresh: entry(5) }) }, [], /'A': unknown parameter fresh/],
    [{ A: record({ sealed: entry(5) }) }, [], /'A': unknown parameter sealed/],
    [{}, [], /holds no records/],
    [{ A: record() }, [finding({ severity: 'huge' })], /F1: severity must be/],
    [{ A: record() }, [finding({ status: 'maybe' })], /F1: status must be/],
    [{ A: record() }, [finding({ record: 'Nope' })], /F1: record 'Nope' is not in ibr-code-review-scores\.json/],
  ];
  for (const [scores, findings, expected] of cases) {
    assert.match(validate(scores, findings).join('\n'), expected);
  }
});

test('the command writes ibr-code-review-score.json, prints the result, and fails on bad input', () => {
  // B loses 2 of 5 levels on Unity (25%): 90; mean 95; one open scoping finding: 93
  const good = runCli({ A: record(), B: record({ unity: entry(3, FULL_EVIDENCE.unity) }) }, [finding({ severity: 'scoping', id: 'F2' })], ['--target', '90']);
  assert.equal(good.code, 0, good.stderr);
  assert.match(good.stdout, /OVERALL 93\.0% \(raw 95\.0%\) · 2 records · rubric version 2/);
  assert.match(good.stdout, /TARGET REACHED \(90%\)/);
  const written = JSON.parse(readFileSync(join(good.folder, 'ibr-code-review-score.json'), 'utf8'));
  assert.equal(written.overall, 93);
  assert.equal(written.openScoping, 1);
  rmSync(good.folder, { recursive: true });

  const below = runCli({ A: record() }, [finding()], ['--target', '95']);
  assert.match(below.stdout, /BELOW TARGET \(95%\)/);
  rmSync(below.folder, { recursive: true });

  const missing = runCli({ A: record() }, undefined);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /file not found: .*ibr-code-review-findings\.json/);
  assert.match(missing.stderr, /NOT SCORED/);
  rmSync(missing.folder, { recursive: true });

  const folder = mkdtempSync(join(tmpdir(), 'review-round-'));
  let noCommit;
  try {
    execFileSync('node', [CLI, folder], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    noCommit = error;
  }
  assert.equal(noCommit?.status, 1);
  assert.match(noCommit.stderr, /missing --commit/);
  rmSync(folder, { recursive: true });
});

test('--previous reports whether open fatal and scoping findings are falling', () => {
  const earlier = runCli({ A: record() }, [finding(), finding({ id: 'F2', severity: 'scoping' })]);
  const fewer = runCli({ A: record() }, [finding()], ['--previous', earlier.folder]);
  assert.match(fewer.stdout, /^FALLING: open fatal \+ scoping findings 2 → 1$/m);
  const same = runCli({ A: record() }, [finding(), finding({ id: 'F3', severity: 'scoping' })], ['--previous', earlier.folder]);
  assert.match(same.stdout, /^NOT FALLING: open fatal \+ scoping findings 2 → 2$/m);
  const none = runCli({ A: record() }, [], ['--previous', earlier.folder]);
  assert.match(none.stdout, /NO OPEN FATAL OR SCOPING FINDINGS/);
  assert.doesNotMatch(none.stdout, /NOT FALLING/);
  for (const run of [earlier, fewer, same, none]) rmSync(run.folder, { recursive: true });
});

// local-invariant: score-integrity — If a round records substrate or tracked measures, then they appear beside the score and never change it; a module tracks more, but is never scored differently.
test('substrate and measures sit beside the score and never change it', () => {
  const scores = { A: record(), B: record({ unity: entry(3, FULL_EVIDENCE.unity) }) };
  const plain = runCli(scores, []);
  const beside = runCli(scores, [], [], {
    substrate: { postgres: '17.1', node: '22.11' },
    measures: { oracleMatches: 10350, coverage: '412 of 430' },
  });
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(beside.code, 0, beside.stderr);
  const plainScore = JSON.parse(readFileSync(join(plain.folder, 'ibr-code-review-score.json'), 'utf8'));
  const besideScore = JSON.parse(readFileSync(join(beside.folder, 'ibr-code-review-score.json'), 'utf8'));
  assert.equal(besideScore.overall, plainScore.overall);
  assert.deepEqual(besideScore.records, plainScore.records);
  assert.deepEqual(besideScore.substrate, { postgres: '17.1', node: '22.11' });
  assert.match(beside.stdout, /substrate: postgres 17\.1 · node 22\.11/);
  assert.match(beside.stdout, /measure oracleMatches: 10350/);
  assert.match(plain.stdout, /substrate: not recorded/);
  for (const run of [plain, beside]) rmSync(run.folder, { recursive: true });
});

test('--previous names every substrate change and every measure that moved', () => {
  const earlier = runCli({ A: record() }, [], [], {
    substrate: { postgres: '16.4', node: '22.11', collation: 'C' },
    measures: { oracleMatches: 10200, coverage: '400 of 430' },
  });
  const later = runCli({ A: record() }, [], ['--previous', earlier.folder], {
    substrate: { postgres: '17.1', node: '22.11', vite: '6.0' },
    measures: { oracleMatches: 10350, coverage: '400 of 430' },
  });
  assert.equal(later.code, 0, later.stderr);
  assert.match(later.stdout, /^SUBSTRATE CHANGED: postgres: 16\.4 → 17\.1$/m);
  assert.match(later.stdout, /^SUBSTRATE CHANGED: collation: C → \(absent\)$/m);
  assert.match(later.stdout, /^SUBSTRATE CHANGED: vite: \(absent\) → 6\.0$/m);
  assert.doesNotMatch(later.stdout, /SUBSTRATE CHANGED: node/);
  assert.match(later.stdout, /^measure oracleMatches: 10200 → 10350$/m);
  assert.doesNotMatch(later.stdout, /measure coverage: .* → /);
  assert.deepEqual(compareSubstrate({ a: '1' }, { a: '1' }), []);
  for (const run of [earlier, later]) rmSync(run.folder, { recursive: true });
});

test('malformed substrate or measures are refused with the reason', () => {
  assert.deepEqual(validateBeside(null, null), []);
  assert.deepEqual(validateBeside({ node: '22' }, { matches: 3, coverage: 'all' }), []);
  assert.match(validateBeside({ node: 22 }, null).join(), /substrate\.json must map each component to its version, as text/);
  assert.match(validateBeside(null, ['3']).join(), /measures\.json must map each measure/);
  const bad = runCli({ A: record() }, [], [], { substrate: ['postgres 17'] });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /NOT SCORED/);
  rmSync(bad.folder, { recursive: true });
});
