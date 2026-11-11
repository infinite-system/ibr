#!/usr/bin/env node
// Compute the ibr-code-review score for one round.
//
// Reads <round folder>/ibr-code-review-scores.json and <round folder>/ibr-code-review-findings.json, applies the rubric
// in ../SKILL.md ("The rubric" and "How findings change the score"), prints the result
// and writes <round folder>/ibr-code-review-score.json. Single file, Node >= 18, no dependencies.
//
// The weights below are the executable copy of the table in SKILL.md; the test suite
// fails if the two disagree.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const RUBRIC_VERSION = 2;
export const WEIGHTS = {
  verified: 25,
  unity: 25,
  proof: 20,
  falsifiable: 15,
  observed: 10,
  anchored: 5,
};
// parameters a record may leave out (null) when they do not apply to it
export const MAY_BE_LEFT_OUT = new Set(['unity', 'observed']);
export const FATAL_CAP = 85;
export const SCOPING_PENALTY = 2;
export const PROOF_CAP = { fatal: 2, scoping: 3 };
export const EVIDENCE_FREE_MAXIMUM = 2;

const HELP = `ibr-code-review-score.mjs — compute the ibr-code-review score for one round (rubric version ${RUBRIC_VERSION})

usage:
  node ibr-code-review-score.mjs <round folder> --commit <hash under review> [--target <percent>] [--previous <earlier round folder>]

reads:
  <round folder>/ibr-code-review-scores.json    { "<record heading>": { "contract", "verdict", "note",
                                  "scores": { "<parameter>": { "level": 0-5, "evidence": { ... } } | null } } }
                                evidence fields per parameter:
                                  verified     command, commit, result (pass|fail), output
                                  unity        home, searches [ ... ], found [ { kind, where, ... } ]
                                  proof        parts [ { part, test | null } ]
                                  falsifiable  bug_report
                                  observed     comparisons [ { input, expected, source, actual, matched } ], or exercised
                                  anchored     sites [ "file:line" ], covers_mechanism (optional)
                                parameters: ${Object.keys(WEIGHTS).join(', ')}
                                null is allowed only for: ${[...MAY_BE_LEFT_OUT].join(', ')}
  <round folder>/ibr-code-review-findings.json  [ { "id", "title", "severity": "fatal|scoping|flag",
                                  "reach": "realistic|contrived", "record": "<heading>" | null,
                                  "status": "open|closed|wrong", ... } ]

reads, if present (recorded beside the score, never in it):
  <round folder>/ibr-code-review-substrate.json  { "<component>": "<version>" }
  <round folder>/ibr-code-review-measures.json   { "<measure>": <number or text> }

writes:
  <round folder>/ibr-code-review-score.json     every record's score, the overall score before and after
                                the findings, and the reason for every adjustment

rules applied:
  - a level above ${EVIDENCE_FREE_MAXIMUM} is lowered to what its evidence supports (no evidence: ${EVIDENCE_FREE_MAXIMUM});
    the script never raises a level
  - a contrived finding counts one severity lower
  - an open fatal finding caps its record's Proof at ${PROOF_CAP.fatal} and the overall score at ${FATAL_CAP}
  - an open scoping finding caps its record's Proof at ${PROOF_CAP.scoping} and costs ${SCOPING_PENALTY} points overall
  - flags, closed findings and wrong findings change nothing

--commit     the commit under review; Verified reaches 5 only for a pass on this commit
--target     print whether the overall score reaches the target
--previous   compare with an earlier round's ibr-code-review-score.json: print NOT FALLING when open
             fatal + scoping findings did not drop, SUBSTRATE CHANGED for each component whose
             version moved, and each measure that changed

exit codes: 0 scored, 1 the input is missing or malformed`;

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const FLAW_KINDS = new Set(['duplication', 'over-unification', 'way-around']);
const commitMatches = (claimed, reviewed) =>
  nonEmpty(claimed) &&
  nonEmpty(reviewed) &&
  (claimed.toLowerCase().startsWith(reviewed.toLowerCase()) ||
    reviewed.toLowerCase().startsWith(claimed.toLowerCase()));

// The highest level a parameter's evidence supports, and the reason. Levels up to 2
// need no evidence. The script lowers a level its evidence does not support; it never
// raises one.
export function supportedMaximum(parameter, evidence, reviewedCommit) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { maximum: EVIDENCE_FREE_MAXIMUM, reason: 'no evidence' };
  }
  switch (parameter) {
    case 'verified':
      if (!nonEmpty(evidence.command) || !nonEmpty(evidence.output) || !['pass', 'fail'].includes(evidence.result)) {
        return { maximum: 2, reason: 'evidence needs command, result (pass or fail) and output' };
      }
      if (evidence.result === 'fail') return { maximum: 3, reason: 'the Verification failed' };
      if (!commitMatches(evidence.commit, reviewedCommit)) {
        return {
          maximum: 4,
          reason: `it passed on ${evidence.commit ?? 'an unnamed commit'}, not on the commit under review (${reviewedCommit})`,
        };
      }
      return { maximum: 5 };
    case 'unity': {
      if (!nonEmpty(evidence.home) || !Array.isArray(evidence.searches) || evidence.searches.length === 0 || !Array.isArray(evidence.found)) {
        return { maximum: 2, reason: 'evidence needs home, at least one search, and found' };
      }
      if (evidence.found.some((flaw) => !FLAW_KINDS.has(flaw?.kind) || !nonEmpty(flaw?.where))) {
        return { maximum: 2, reason: 'each found item needs kind (duplication, over-unification or way-around) and where' };
      }
      return { maximum: Math.max(0, 5 - evidence.found.length), reason: `${evidence.found.length} flaw(s) found` };
    }
    case 'proof': {
      if (!Array.isArray(evidence.parts) || evidence.parts.length === 0 || evidence.parts.some((part) => !nonEmpty(part?.part))) {
        return { maximum: 2, reason: 'evidence needs parts, each naming its part' };
      }
      const unproven = evidence.parts.filter((part) => !nonEmpty(part.test)).length;
      return { maximum: unproven === 0 ? 5 : unproven === 1 ? 4 : 3, reason: `${unproven} part(s) without a test` };
    }
    case 'falsifiable':
      return nonEmpty(evidence.bug_report) ? { maximum: 5 } : { maximum: 2, reason: 'evidence needs bug_report' };
    case 'observed': {
      const comparisons = Array.isArray(evidence.comparisons) ? evidence.comparisons : [];
      if (comparisons.length === 0) {
        return nonEmpty(evidence.exercised)
          ? { maximum: 3, reason: 'exercised, but compared with no independent answer' }
          : { maximum: 2, reason: 'evidence needs comparisons, or what was exercised' };
      }
      const complete = (comparison) =>
        ['input', 'expected', 'source', 'actual'].every((field) => nonEmpty(comparison?.[field])) &&
        typeof comparison?.matched === 'boolean';
      if (!comparisons.every(complete)) {
        return { maximum: 2, reason: 'each comparison needs input, expected, source, actual and matched' };
      }
      if (comparisons.some((comparison) => !comparison.matched)) {
        return { maximum: 3, reason: 'a comparison did not match' };
      }
      return { maximum: 5 };
    }
    case 'anchored': {
      if (!Array.isArray(evidence.sites) || evidence.sites.some((site) => !nonEmpty(site))) {
        return { maximum: 2, reason: 'evidence needs sites' };
      }
      const count = evidence.sites.length;
      if (count >= 3 || (count >= 1 && evidence.covers_mechanism === true)) return { maximum: 5 };
      return { maximum: count === 2 ? 4 : count === 1 ? 3 : 2, reason: `${count} annotated site(s)` };
    }
    default:
      return { maximum: 0, reason: 'unknown parameter' };
  }
}

// A contrived finding counts one level lower than its stated severity.
export function effectiveSeverity(finding) {
  if (finding.reach !== 'contrived') return finding.severity;
  if (finding.severity === 'fatal') return 'scoping';
  return 'flag';
}

export function validate(scores, findings) {
  const problems = [];
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    return ['ibr-code-review-scores.json must be an object keyed by record heading'];
  }
  if (Object.keys(scores).length === 0) {
    problems.push('ibr-code-review-scores.json holds no records — a project with no contracts is not scored');
  }
  for (const [recordName, record] of Object.entries(scores)) {
    const parameters = record?.scores;
    if (!parameters || typeof parameters !== 'object') {
      problems.push(`'${recordName}': missing "scores"`);
      continue;
    }
    for (const parameter of Object.keys(WEIGHTS)) {
      if (!(parameter in parameters)) {
        problems.push(`'${recordName}': missing parameter ${parameter}`);
        continue;
      }
      const entry = parameters[parameter];
      if (entry === null) {
        if (!MAY_BE_LEFT_OUT.has(parameter)) {
          problems.push(`'${recordName}': ${parameter} cannot be left out (null)`);
        }
        continue;
      }
      if (!Number.isInteger(entry?.level) || entry.level < 0 || entry.level > 5) {
        problems.push(`'${recordName}': ${parameter} level must be a whole number from 0 to 5`);
      }
    }
    for (const parameter of Object.keys(parameters)) {
      if (!(parameter in WEIGHTS)) {
        problems.push(`'${recordName}': unknown parameter ${parameter}`);
      }
    }
  }
  if (!Array.isArray(findings)) {
    problems.push('ibr-code-review-findings.json must be an array');
    return problems;
  }
  for (const finding of findings) {
    const label = finding?.id ?? '(finding with no id)';
    if (!['fatal', 'scoping', 'flag'].includes(finding?.severity)) {
      problems.push(`${label}: severity must be fatal, scoping or flag`);
    }
    if (!['realistic', 'contrived'].includes(finding?.reach)) {
      problems.push(`${label}: reach must be realistic or contrived`);
    }
    if (!['open', 'closed', 'wrong'].includes(finding?.status)) {
      problems.push(`${label}: status must be open, closed or wrong`);
    }
    if (finding?.record != null && !(finding.record in scores)) {
      problems.push(`${label}: record '${finding.record}' is not in ibr-code-review-scores.json`);
    }
  }
  return problems;
}

export function computeScore(scores, findings, reviewedCommit) {
  const adjustments = [];
  const openFindings = findings.filter((finding) => finding.status === 'open');
  const counting = openFindings
    .map((finding) => ({ ...finding, counts: effectiveSeverity(finding) }))
    .filter((finding) => finding.counts !== 'flag');

  const records = {};
  for (const [recordName, record] of Object.entries(scores)) {
    const levels = {};
    for (const parameter of Object.keys(WEIGHTS)) {
      const entry = record.scores[parameter];
      if (entry === null) {
        levels[parameter] = null;
        continue;
      }
      let level = entry.level;
      if (level > EVIDENCE_FREE_MAXIMUM) {
        const { maximum, reason } = supportedMaximum(parameter, entry.evidence, reviewedCommit);
        if (level > maximum) {
          adjustments.push(`'${recordName}': ${parameter} ${level} → ${maximum} (${reason})`);
          level = maximum;
        }
      }
      levels[parameter] = level;
    }
    for (const finding of counting) {
      if (finding.record !== recordName) continue;
      const cap = PROOF_CAP[finding.counts];
      if (levels.proof > cap) {
        adjustments.push(
          `'${recordName}': proof ${levels.proof} → ${cap} (open ${finding.counts} finding ${finding.id})`,
        );
        levels.proof = cap;
      }
    }
    let weightedSum = 0;
    let weightTotal = 0;
    for (const [parameter, weight] of Object.entries(WEIGHTS)) {
      if (levels[parameter] === null) continue;
      weightedSum += levels[parameter] * weight;
      weightTotal += weight;
    }
    records[recordName] = {
      contract: record.contract ?? null,
      verdict: record.verdict ?? null,
      levels,
      score: roundToOneDecimal((100 * weightedSum) / weightTotal / 5),
    };
  }

  const recordScores = Object.values(records).map((record) => record.score);
  const raw = roundToOneDecimal(
    recordScores.reduce((sum, score) => sum + score, 0) / recordScores.length,
  );
  const openFatal = counting.filter((finding) => finding.counts === 'fatal');
  const openScoping = counting.filter((finding) => finding.counts === 'scoping');

  let overall = raw;
  if (openScoping.length > 0) {
    const penalty = SCOPING_PENALTY * openScoping.length;
    overall = roundToOneDecimal(Math.max(0, overall - penalty));
    adjustments.push(
      `overall: minus ${penalty} for ${openScoping.length} open scoping finding(s) (${openScoping.map((finding) => finding.id).join(', ')})`,
    );
  }
  if (openFatal.length > 0 && overall > FATAL_CAP) {
    adjustments.push(
      `overall: ${overall} → capped at ${FATAL_CAP} by open fatal finding(s) (${openFatal.map((finding) => finding.id).join(', ')})`,
    );
    overall = FATAL_CAP;
  }

  return {
    rubricVersion: RUBRIC_VERSION,
    commit: reviewedCommit ?? null,
    recordCount: recordScores.length,
    raw,
    overall,
    openFatal: openFatal.length,
    openScoping: openScoping.length,
    openFlags: openFindings.length - counting.length,
    adjustments,
    records,
  };
}

function readJson(path, problems) {
  if (!existsSync(path)) {
    problems.push(`file not found: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${path}: not valid JSON (${error.message})`);
    return null;
  }
}

// Substrate and tracked measures sit beside the score and never enter it: the score is
// computed before they are read, so no module can change how it is scored.
export function validateBeside(substrate, measures) {
  const problems = [];
  const flatObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (substrate !== null) {
    if (!flatObject(substrate) || Object.values(substrate).some((version) => !nonEmpty(version))) {
      problems.push('ibr-code-review-substrate.json must map each component to its version, as text');
    }
  }
  if (measures !== null) {
    if (
      !flatObject(measures) ||
      Object.values(measures).some((value) => typeof value !== 'number' && !nonEmpty(value))
    ) {
      problems.push('ibr-code-review-measures.json must map each measure to a number or a text value');
    }
  }
  return problems;
}

export function compareSubstrate(previous, current) {
  const changes = [];
  for (const component of new Set([...Object.keys(previous ?? {}), ...Object.keys(current ?? {})])) {
    const before = previous?.[component];
    const now = current?.[component];
    if (before === now) continue;
    changes.push(`${component}: ${before ?? '(absent)'} → ${now ?? '(absent)'}`);
  }
  return changes;
}

function readOptionalJson(path, problems) {
  return existsSync(path) ? readJson(path, problems) : null;
}

function main(argv) {
  if (argv.includes('--help') || argv.length === 0) {
    console.log(HELP);
    return 0;
  }
  let roundFolder = null;
  let target = null;
  let previousFolder = null;
  let reviewedCommit = null;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--target') target = Number(argv[++index]);
    else if (argv[index] === '--commit') reviewedCommit = argv[++index];
    else if (argv[index] === '--previous') previousFolder = argv[++index];
    else if (argv[index].startsWith('--')) {
      console.error(`unknown option ${argv[index]} (--help for usage)`);
      return 1;
    } else roundFolder = argv[index];
  }
  if (!roundFolder) {
    console.error('missing the round folder (--help for usage)');
    return 1;
  }
  if (!nonEmpty(reviewedCommit)) {
    console.error('missing --commit <hash under review> (--help for usage)');
    return 1;
  }
  roundFolder = resolve(roundFolder);
  const problems = [];
  const scores = readJson(join(roundFolder, 'ibr-code-review-scores.json'), problems);
  const findings = readJson(join(roundFolder, 'ibr-code-review-findings.json'), problems);
  const substrate = readOptionalJson(join(roundFolder, 'ibr-code-review-substrate.json'), problems);
  const measures = readOptionalJson(join(roundFolder, 'ibr-code-review-measures.json'), problems);
  if (problems.length === 0) problems.push(...validate(scores, findings), ...validateBeside(substrate, measures));
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`NOT SCORED: ${problems.length} problem(s) in the input`);
    return 1;
  }

  const result = { ...computeScore(scores, findings, reviewedCommit), substrate, measures };
  writeFileSync(join(roundFolder, 'ibr-code-review-score.json'), JSON.stringify(result, null, 2) + '\n');

  const byScore = Object.entries(result.records).sort(
    ([, first], [, second]) => first.score - second.score,
  );
  for (const [recordName, record] of byScore) {
    console.log(`${record.score.toFixed(1).padStart(5)}%  ${recordName}`);
  }
  for (const adjustment of result.adjustments) console.log(`adjusted: ${adjustment}`);
  console.log(
    `open findings: ${result.openFatal} fatal, ${result.openScoping} scoping, ${result.openFlags} flag(s)`,
  );
  console.log(
    `OVERALL ${result.overall.toFixed(1)}% (raw ${result.raw.toFixed(1)}%) · ${result.recordCount} records · rubric version ${RUBRIC_VERSION}`,
  );
  if (substrate) {
    console.log(`substrate: ${Object.entries(substrate).map(([component, version]) => `${component} ${version}`).join(' · ')}`);
  } else {
    console.log('substrate: not recorded');
  }
  for (const [name, value] of Object.entries(measures ?? {})) console.log(`measure ${name}: ${value}`);
  if (target !== null && !Number.isNaN(target)) {
    console.log(
      result.overall >= target ? `TARGET REACHED (${target}%)` : `BELOW TARGET (${target}%)`,
    );
  }
  if (previousFolder) {
    const previousProblems = [];
    const previous = readJson(join(resolve(previousFolder), 'ibr-code-review-score.json'), previousProblems);
    if (!previous) {
      console.error(previousProblems.join('\n'));
      return 1;
    }
    for (const change of compareSubstrate(previous.substrate, substrate)) {
      console.log(`SUBSTRATE CHANGED: ${change}`);
    }
    for (const [name, value] of Object.entries(measures ?? {})) {
      if (previous.measures && name in previous.measures && previous.measures[name] !== value) {
        console.log(`measure ${name}: ${previous.measures[name]} → ${value}`);
      }
    }
    const before = previous.openFatal + previous.openScoping;
    const now = result.openFatal + result.openScoping;
    if (now === 0) console.log('NO OPEN FATAL OR SCOPING FINDINGS');
    else
      console.log(
        now < before
          ? `FALLING: open fatal + scoping findings ${before} → ${now}`
          : `NOT FALLING: open fatal + scoping findings ${before} → ${now}`,
      );
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exit(main(process.argv.slice(2)));
}
