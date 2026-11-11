#!/usr/bin/env node
// Validate invariant contract files (*.invariants.md).
//
// Canonical schema (see the skill's SKILL.md):
//   - two sections, in order: '## Reality-based invariants', '## Chosen invariants'
//     ('## Designed invariants' accepted as a legacy alias for the second section)
//   - a full generator record under '## Generator', followed by reality and chosen records
//     headed '### <Invariant Name>' — UNNUMBERED. Names are the identifiers;
//     reference invariants by name, never by number (numbers rot when contracts reorder).
//     Legacy numbered headings ('### PB-R001 — Name') still parse but draw a note.
//   - names unique per file in slug-space; field values may wrap onto following lines
//   - required fields: Invariant, Scope, Mechanism, Evidence, Rules out,
//     Verification, Status (provisional|established), Last refined (YYYY-MM-DD)
//   - optional fields: 'Renegotiable at' (reality records only), 'Components',
//     'Generates', 'Rejected alternatives', 'Open question', 'Enforcement' (review-time
//     enforcement declaration — records so marked are exempt from annotation coverage)
//
// Usage:
//   ibr-code-invariants-check.mjs PATH            validate one contract
//   ibr-code-invariants-check.mjs --all [ROOT]    discover and validate every *.invariants.md under
//                                        ROOT (default: git toplevel or cwd); non-canonical
//                                        files are reported and skipped, not failed;
//                                        exits 2 if zero contracts exist under ROOT
//   --strict                             with --all: non-canonical files fail instead of skip
//   ibr-code-invariants-check.mjs --refs [ROOT]   scan code for
//                                        'invariant: <Name> (<root-relative contract path>)'
//                                        annotations, test-file generator headers, source
//                                        tripwires, companion links, and italic prose
//                                        citations; fail on orphans
//                                        (name, anchor, or contract path that no longer
//                                        resolves); report per-record annotation coverage
//   --version                            print checker + schema version (skew diagnosis)
//
// Exit codes: 0 all validated files pass · 1 validation errors · 2 usage/IO error.
// Requires node >= 18. No dependencies. CRLF and BOM are normalized on read; fenced code
// blocks and HTML comments are inert (headings/annotations/links inside them are ignored).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, basename } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import process from 'node:process';

// Bump when schema fields or validation semantics change.
const VERSION = '6.0.0';
const GENERATOR_SUFFIX = '.generator.md';
const LEGACY_LATTICE_SUFFIX = '.lattice.md';
const GENERATOR_HEADING = '## Generator';
const GENERATOR_SENTINEL = '=== GENERATOR ===';
const GENERATOR_DESCRIBED_SENTINEL = '=== GENERATOR-DESCRIBED ===';
const RETIRED_SPEC_SENTINELS = ['=== SPEC ===', '=== SPECIFICATIONS ==='];
// `// local-invariant:` marks a claim recorded only in this file's header (canonical);
// `// domain-invariant:` is its legacy alias and still resolves.
const LOCAL_INVARIANT_KEYWORD_RE = /(?:local|domain)-invariant:/;
const DOMAIN_INVARIANT_LINE_RE =
  /^\s*\/\/\s*(?:local|domain)-invariant:\s*(.+?)\s+—\s+(.+)\s*$/;
// `// rules-out:` proves one thing a record rules out (canonical); `// impossible-if-true:`
// is its legacy alias and still resolves.
const RULES_OUT_KEYWORD_RE = /(?:rules-out|impossible-if-true):/;
const IMPOSSIBLE_IF_TRUE_LINE_RE =
  /^\s*\/\/\s*(?:rules-out|impossible-if-true):\s*(.+?)\s+—\s+(.+)\s*$/;
const DOMAIN_INVARIANT_TRIPWIRE_RE =
  /^\s*\/\/\s*(?:local|domain)-invariant:\s*([^—\n]+?)\s*$/;
const LEGACY_TEST_HEADERS = new Set();

const REALITY = '## Reality-based invariants';
const CHOSEN = '## Chosen invariants';
const CHOSEN_ALIAS = '## Designed invariants'; // legacy heading, accepted
const HEAD_RE = /^### (.*\S)$/;
const LEGACY_ID_RE = /^([A-Z][A-Z0-9]*)-([RCD])([0-9]{3})(?:\s+—\s+(.*))?$/;
// A field opens ONLY on a known label in bold at the start of a line —
// `**Mechanism:** …`. Bold-labelled bullets and bold words inside a line are
// the current field's body: a field spans paragraphs and lists until the next
// label or heading. A label seen twice in one record is a problem, never a
// silent overwrite. (The regex is built after the label lists below.)
let FIELD_RE;
// A non-bullet line that OPENS like a field (`**Mechansim:** …`) but names no
// known label is a misspelled or newer-schema field, never silent body text —
// otherwise a typo'd optional field would vanish into the field above it.
const FIELD_SHAPE_RE = /^\*\*([^*:]+):\*\*/;
const REQUIRED = [
  'Invariant',
  'Scope',
  'Mechanism',
  'Evidence',
  'Rules out',
  'Verification',
  'Status',
  'Last refined',
];
const OPTIONAL = [
  'Goal',
  'Renegotiable at',
  'Components',
  'Generates',
  'Rejected alternatives',
  'Open question',
  'Enforcement',
  'Stands on',
];
// labels earlier versions used, each read as its canonical label
const FIELD_ALIASES = { 'Impossible if true': 'Rules out' };
FIELD_RE = new RegExp(
  '^\\*\\*(' +
    [...REQUIRED, ...OPTIONAL, ...Object.keys(FIELD_ALIASES)].map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
    '):\\*\\*\\s*(.*)$',
);
const STATUSES = new Set(['established', 'provisional']);
const DATE_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.claude']);
// The result must depend only on what the repository contains, so the walk skips
// every path git ignores: a gitignored path is in no clone and no CI checkout, and
// scanning it makes a live checkout disagree with a clean one (and scratch folders
// of huge transcripts made the walk crawl). Tracked directories that still must not
// be read — archived transcripts, retired harness scripts — are listed in an
// optional `.invariantsignore` at the walk root: one root-relative directory per
// line, `#` starts a comment. The checker itself names no project's layout.
const IGNORE_FILE = '.invariantsignore';
const IGNORED_BY_ROOT = new Map();
const GITIGNORED_BY_ROOT = new Map();

// Paths git ignores under root, relative to root: wholly ignored directories come back
// as one `dir/` entry, so the listing stays small however large the ignored tree is.
// Outside a git checkout (or without git) nothing is ignored this way.
function gitIgnoredPaths(root) {
  if (!GITIGNORED_BY_ROOT.has(root)) {
    const directories = new Set();
    const files = new Set();
    try {
      const output = execFileSync(
        'git',
        ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
      );
      for (const entry of output.split('\0')) {
        if (!entry) continue;
        if (entry.endsWith('/')) directories.add(entry.slice(0, -1));
        else files.add(entry);
      }
    } catch {
      // not a git checkout, or git unavailable: walk the filesystem as before
    }
    GITIGNORED_BY_ROOT.set(root, { directories, files });
  }
  return GITIGNORED_BY_ROOT.get(root);
}
function ignoredDirectories(root) {
  if (!IGNORED_BY_ROOT.has(root)) {
    const ignored = new Set();
    const file = join(root, IGNORE_FILE);
    if (existsSync(file)) {
      for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
        if (line) ignored.add(line);
      }
    }
    IGNORED_BY_ROOT.set(root, ignored);
  }
  return IGNORED_BY_ROOT.get(root);
}
const ANNOT_RE =
  /(?<![\w-])invariant:\s*([^(\n]+?)\s*\(([^)\n]*\.invariants\.md)\)/g;
// annotation-shaped lines that DON'T parse (typo'd suffix, wrong brackets) — flagged, not silent
const ANNOT_LOOSE_RE =
  /(?<![\w-])invariant:\s*\S[^\n]*?[([][^)\]\n]*\.(?:md|invariants)\b[^)\]\n]*[)\]]/i;
const HEADING_SUFFIX_RE = /\s*_\(.*\)_\s*$/; // strip italic asides in local headings
const MAX_SCAN_BYTES = 2_000_000;
const NAME_CHARSET_RE = /[^A-Za-z0-9 -]/; // canonical name charset: letters/digits/spaces/hyphens

// ---------------------------------------------------------------------------
// reading + masking

function readText(path) {
  // BOM stripped, CRLF/CR normalized — Windows-edited files parse identically
  return readFileSync(path, 'utf-8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function maskInert(lines) {
  // active[i] = false for lines inside fenced code blocks or HTML comments; such lines
  // are invisible to structural parsing AND to annotation/link scanning.
  const active = new Array(lines.length).fill(true);
  let fence = null; // the fence marker string when inside a fence
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      active[i] = false;
      const close = line.trimStart();
      if (close.startsWith(fence)) fence = null;
      continue;
    }
    const open = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (open && !inComment) {
      fence = open[2];
      active[i] = false;
      continue;
    }
    if (inComment) {
      active[i] = false;
      if (line.includes('-->')) inComment = false;
      continue;
    }
    // same-line HTML comments: blank the commented spans but keep the line active
    let l = line;
    if (l.includes('<!--')) {
      l = l.replace(/<!--.*?-->/g, (m) => ' '.repeat(m.length));
      if (l.includes('<!--')) {
        // comment opens and doesn't close on this line
        l = l.slice(0, l.indexOf('<!--'));
        inComment = true;
      }
      lines[i] = l; // masked copy — callers pass their own array
    }
  }
  return active;
}

function readMasked(path) {
  const lines = readText(path).split('\n');
  const active = maskInert(lines);
  return { lines, active };
}

function stripInlineCode(line) {
  // `code spans` are inert for annotation/link scanning
  return line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
}

// ---------------------------------------------------------------------------
// slugs

// Canonical slug: lowercase, strip everything but letters/digits (any script),
// spaces and hyphens, spaces -> dashes. Matches GitHub's rendered heading anchors.
export function invariantHeadingSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}

// ---------------------------------------------------------------------------
// contract parsing + validation

function bounds(lines, active) {
  const reality = [],
    chosen = [];
  lines.forEach((line, i) => {
    if (!active[i]) return;
    const t = line.trim();
    if (t === REALITY) reality.push(i);
    if (t === CHOSEN || t === CHOSEN_ALIAS) chosen.push(i);
  });
  if (reality.length !== 1 || chosen.length !== 1)
    return [
      null,
      [
        'document: exactly one reality and one chosen (or legacy designed) heading required',
      ],
    ];
  if (reality[0] >= chosen[0])
    return [null, ['document: reality section must precede chosen section']];
  let end = lines.length;
  for (let i = chosen[0] + 1; i < lines.length; i++) {
    if (active[i] && lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return [[reality[0] + 1, chosen[0], chosen[0] + 1, end], []];
}

function parseSection(lines, active, start, end, kind = 'domain') {
  // records with multi-line field accumulation: a non-blank line that is neither a new
  // field nor a heading continues the current field (wrapped prose stays visible)
  const records = [];
  let i = start;
  while (i < end) {
    if (!active[i] || !lines[i].startsWith('### ')) {
      i++;
      continue;
    }
    const head = HEAD_RE.exec(lines[i]);
    if (!head) {
      records.push({ name: null, line: i + 1, fields: {} });
      i++;
      continue;
    }
    const rec = {
      name: head[1].trim(),
      line: i + 1,
      fields: {},
      fieldRanges: {},
      kind,
    };
    i++;
    let current = null;
    while (
      i < end &&
      !(
        active[i] &&
        (lines[i].startsWith('### ') || lines[i].startsWith('## '))
      )
    ) {
      if (active[i]) {
        const t = lines[i].trim();
        const f = FIELD_RE.exec(t);
        if (f) {
          current = FIELD_ALIASES[f[1].trim()] ?? f[1].trim();
          if (current in rec.fields) {
            rec.duplicateFields = rec.duplicateFields || [];
            rec.duplicateFields.push({ label: current, line: i + 1 });
          }
          rec.fields[current] = f[2].trim();
          rec.fieldRanges[current] = { start: i + 1, end: i + 1 };
        } else if (FIELD_SHAPE_RE.test(t)) {
          rec.unknownFields = rec.unknownFields || [];
          rec.unknownFields.push(FIELD_SHAPE_RE.exec(t)[1].trim());
          current = null;
        } else if (t && current) {
          rec.fields[current] =
            (rec.fields[current] ? rec.fields[current] + ' ' : '') + t;
          rec.fieldRanges[current].end = i + 1;
        }
      }
      i++;
    }
    records.push(rec);
  }
  return records;
}

function generatorSectionBounds(lines, active) {
  const headingIndexes = [];
  lines.forEach((line, index) => {
    if (active[index] && line.trim() === GENERATOR_HEADING) {
      headingIndexes.push(index);
    }
  });
  if (headingIndexes.length === 0) return null;
  if (headingIndexes.length > 1) return { duplicate: true };
  const start = headingIndexes[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index++) {
    if (active[index] && lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }
  return { start, end, duplicate: false };
}

function parseGeneratorRecords(lines, active) {
  const sectionBounds = generatorSectionBounds(lines, active);
  if (!sectionBounds || sectionBounds.duplicate) return [];
  return parseSection(
    lines,
    active,
    sectionBounds.start,
    sectionBounds.end,
    'generator',
  );
}

function validateRecords(
  records,
  isReality,
  seenNames,
  seenSlugs,
  errors,
  notes,
  requiredFields = REQUIRED,
) {
  let count = 0;
  for (const rec of records) {
    if (rec.name === null) {
      errors.push(`document: empty invariant heading at line ${rec.line}`);
      continue;
    }
    const name = rec.name;
    const legacy = LEGACY_ID_RE.exec(name);
    if (legacy) {
      notes.push(
        `'${name}': numbered heading — canonical style is an unnumbered name;` +
          ' reference invariants by name, not number',
      );
      if (isReality && legacy[2] !== 'R')
        errors.push(`'${name}': chosen-lettered ID in the reality section`);
      if (!isReality && legacy[2] === 'R')
        errors.push(`'${name}': reality-lettered ID in the chosen section`);
    }
    if (seenNames.has(name)) errors.push(`'${name}': duplicate invariant name`);
    seenNames.add(name);
    if (!legacy && NAME_CHARSET_RE.test(name)) {
      notes.push(
        `'${name}': name contains punctuation — canonical charset is letters/digits/` +
          'spaces/hyphens: code annotations match byte-exactly (smart-quote/dash editor drift ' +
          'creates invisible orphans), and platform heading anchors only agree on this charset',
      );
    }
    if (!legacy && name.split(/\s+/).length > 12) {
      notes.push(
        `'${name}': name has ${name.split(/\s+/).length} words — names run 3 to 12 words; a longer one usually ` +
          'joins two claims (split it, or use Components) or restates the if-then (move it to Invariant)',
      );
    }
    if (!legacy && /^-|-$|--/.test(name)) {
      notes.push(
        `'${name}': hyphens must be word-internal (no leading/trailing/double hyphens)`,
      );
    }
    const slug = invariantHeadingSlug(name);
    if (!/[\p{L}\p{N}]/u.test(slug)) {
      errors.push(
        `'${name}': name has no sluggable characters — anchors are reference identity` +
          ' and this name produces an empty one',
      );
    } else {
      if (seenSlugs.has(slug) && seenSlugs.get(slug) !== name) {
        errors.push(
          `'${name}': slug collision with '${seenSlugs.get(slug)}' (both -> #${slug}) — ` +
            'anchors are reference identity, slugs must be unique per file',
        );
      }
      seenSlugs.set(slug, name);
    }
    const fields = rec.fields;
    for (const dup of rec.duplicateFields || [])
      errors.push(`'${name}': ${dup.label} appears twice (line ${dup.line}) — one field, as many lines as it needs`);
    for (const label of requiredFields) {
      if (!fields[label]) errors.push(`'${name}': missing or empty ${label}`);
    }
    // A chosen invariant (a composition included) is chosen FOR something: without its
    // Goal the choice can be checked but never judged, so it can never be released.
    // Reality was chosen by no one, so it has no goal.
    if (isReality === true && fields['Goal']) {
      errors.push(
        `'${name}': Goal is only valid on chosen records — reality invariants were chosen by no one`,
      );
    }
    if (isReality !== true && !fields['Goal']) {
      errors.push(
        `'${name}': chosen invariant needs Goal — the intent it was chosen for; construction without a goal cannot be judged or released`,
      );
    }
    for (const label of rec.unknownFields || []) {
      errors.push(
        `'${name}': unknown field '${label}' (tolerated fields: ` +
          `${[...REQUIRED, ...OPTIONAL].join(', ')}) — if this field is from a newer schema, ` +
          `update this checker (--version prints ${VERSION})`,
      );
    }
    if (fields['Renegotiable at'] && isReality === false) {
      errors.push(
        `'${name}': 'Renegotiable at' is only valid on reality records —` +
          ' chosen invariants are renegotiable by decision at their own scope',
      );
    }
    if (fields['Status'] && !STATUSES.has(fields['Status']))
      errors.push(
        `'${name}': invalid Status (want: ${[...STATUSES].sort().join('|')})`,
      );
    if (fields['Last refined'] && !DATE_RE.test(fields['Last refined']))
      errors.push(`'${name}': Last refined must match YYYY-MM-DD`);
    count++;
  }
  return count;
}

function validateGeneratorComponents(path, record, errors) {
  const components = record.fields.Components;
  if (!components) {
    errors.push(`'${record.name}': a legacy Generator record needs Components`);
    return;
  }
  const links = extractLinks(components);
  if (links.length === 0) {
    errors.push(
      `'${record.name}': Components must link to the invariant records they compose`,
    );
    return;
  }
  for (const link of links) {
    if (link.target === null) {
      errors.push(
        `'${record.name}': Components has undefined link reference [${link.key}]`,
      );
      continue;
    }
    const decoded = (() => {
      try {
        return decodeURIComponent(link.target);
      } catch {
        return link.target;
      }
    })();
    const [componentPath, anchor] = decoded.split('#');
    if (!anchor) {
      errors.push(
        `'${record.name}': component '${link.text}' needs a record anchor`,
      );
      continue;
    }
    let targetPath = componentPath
      ? resolve(dirname(path), componentPath)
      : resolve(path);
    if (!existsSync(targetPath) && componentPath) {
      targetPath = resolve(gitToplevel(), componentPath);
    }
    if (!existsSync(targetPath)) {
      errors.push(
        `'${record.name}': component contract not found: ${componentPath}`,
      );
      continue;
    }
    const targetSlugs = invariantReferenceSlugs(targetPath);
    if (!targetSlugs.has(anchor)) {
      errors.push(
        `'${record.name}': component anchor '#${anchor}' does not resolve in ${componentPath || basename(path)}`,
      );
    }
  }
}

function checkFile(path) {
  // Returns { status: 'pass'|'fail'|'noncanonical', errors, notes, summary }
  let lines, active;
  try {
    ({ lines, active } = readMasked(path));
  } catch (error) {
    return {
      status: 'fail',
      errors: [`document: cannot read UTF-8: ${error.message}`],
      notes: [],
      summary: '',
    };
  }
  if (!lines.some((l, i) => active[i] && l.trim() === REALITY))
    return {
      status: 'noncanonical',
      errors: [],
      notes: [],
      summary: 'no canonical section headings (local format)',
    };
  return validateContractLines(path, lines, active);
}

// The contract grammar, wherever it lives: a *.invariants.md file, or a test file's
// header (where Evidence and Verification are the tests beneath, so not required).
// `path` is the contract file; null for a test header, whose links its caller resolves.
function validateContractLines(path, lines, active, requiredFields = REQUIRED) {
  const [sectionBounds, errors] = bounds(lines, active);
  const records = { generator: [], reality: [], chosen: [] };
  const notes = [];
  lines.forEach((l, i) => {
    if (!active[i] && /^### \S/.test(l)) {
      notes.push(
        `line ${i + 1}: record-shaped heading inside a fence/comment is INERT — ` +
          'fencing a record removes it from enforcement without a visible deletion',
      );
    }
  });
  let realityCount = 0,
    chosenCount = 0,
    generatorCount = 0,
    summary = '';
  if (sectionBounds) {
    const seenNames = new Set();
    const seenSlugs = new Map();
    const generatorBounds = generatorSectionBounds(lines, active);
    let generatorRecords = [];
    if (generatorBounds?.duplicate) {
      errors.push('document: exactly one Generator heading is allowed');
    } else if (generatorBounds) {
      generatorRecords = parseGeneratorRecords(lines, active);
      if (generatorRecords.length !== 1) {
        errors.push(
          'document: a Generator section must carry exactly one full invariant record',
        );
      } else {
        generatorCount = validateRecords(
          generatorRecords,
          null,
          seenNames,
          seenSlugs,
          errors,
          notes,
          requiredFields,
        );
        records.generator = generatorRecords;
        notes.push(
          'legacy ## Generator section — move its record under ## Chosen invariants; any record whose Components link other records composes them',
        );
        if (path) validateGeneratorComponents(path, generatorRecords[0], errors);
        else if (!generatorRecords[0].fields.Components)
          errors.push(`'${generatorRecords[0].name}': a legacy Generator record needs Components`);
      }
    }
    const realityRecords = parseSection(
      lines,
      active,
      sectionBounds[0],
      sectionBounds[1],
    );
    const chosenRecords = parseSection(
      lines,
      active,
      sectionBounds[2],
      sectionBounds[3],
    );
    realityCount = validateRecords(
      realityRecords,
      true,
      seenNames,
      seenSlugs,
      errors,
      notes,
      requiredFields,
    );
    chosenCount = validateRecords(
      chosenRecords,
      false,
      seenNames,
      seenSlugs,
      errors,
      notes,
      requiredFields,
    );
    records.reality = realityRecords;
    records.chosen = chosenRecords;
    if (realityCount + chosenCount < 1)
      errors.push('document: at least one invariant is required');
    else if (realityCount === 0 || chosenCount === 0)
      notes.push('one category is empty — fine while bootstrapping');
    summary =
      `${realityCount} reality, ${chosenCount} chosen invariants` +
      (generatorCount ? ` (+${generatorCount} in a legacy Generator section)` : '');
  }
  return {
    status: errors.length ? 'fail' : 'pass',
    errors,
    notes,
    summary,
    records,
  };
}

// Every record of a canonical contract with its kind: 'reality', 'chosen', or
// 'legacy-generator' for a record under a legacy ## Generator heading.
function recordsWithKinds(path) {
  try {
    const { lines, active } = readMasked(path);
    const [sectionBounds] = bounds(lines, active);
    if (!sectionBounds) return { lines, active, records: [] };
    const tag = (records, kind) =>
      records.filter((record) => record.name !== null).map((record) => ({ record, kind }));
    return {
      lines,
      active,
      records: [
        ...tag(parseGeneratorRecords(lines, active), 'legacy-generator'),
        ...tag(parseSection(lines, active, sectionBounds[0], sectionBounds[1]), 'reality'),
        ...tag(parseSection(lines, active, sectionBounds[2], sectionBounds[3]), 'chosen'),
      ],
    };
  } catch {
    return { lines: [], active: [], records: [] };
  }
}

// The links written inside one field of a record: [{ targetPath, anchor, line }].
function fieldLinks(path, lines, active, record, label) {
  const range = record.fieldRanges?.[label];
  if (!range) return [];
  const text = lines
    .map((line, index) =>
      active[index] && index >= range.start - 1 && index < range.end ? stripInlineCode(line) : '',
    )
    .join('\n');
  const links = [];
  for (const link of extractLinks(text)) {
    if (!link.target) continue;
    const [linkPath, anchor] = decodedLinkTarget(link.target).split('#');
    if (!anchor) continue;
    links.push({
      targetPath: linkPath ? resolve(dirname(path), linkPath) : resolve(path),
      anchor,
      line: link.line,
    });
  }
  return links;
}

function canonicalRecords(path) {
  // [{name, fields}] for canonical contracts; [] for local-format or structurally
  // broken files (a broken canonical file must NOT fall back to loose harvesting —
  // that would resurrect section headings as annotation targets)
  try {
    const { lines, active } = readMasked(path);
    const [sectionBounds] = bounds(lines, active);
    if (!sectionBounds) return [];
    return [
      ...parseSection(lines, active, sectionBounds[0], sectionBounds[1]),
      ...parseSection(lines, active, sectionBounds[2], sectionBounds[3]),
    ].filter((r) => r.name !== null);
  } catch {
    return [];
  }
}

function canonicalGeneratorRecords(path) {
  try {
    const { lines, active } = readMasked(path);
    return parseGeneratorRecords(lines, active).filter(
      (record) => record.name !== null,
    );
  } catch {
    return [];
  }
}

function canonicalAllRecords(path) {
  return [...canonicalGeneratorRecords(path), ...canonicalRecords(path)];
}

function isCanonicalShaped(path) {
  try {
    const { lines, active } = readMasked(path);
    return lines.some((l, i) => active[i] && l.trim() === REALITY);
  } catch {
    return false;
  }
}

function contractNames(path) {
  // loose harvest for LOCAL-FORMAT files only: ##/### headings, italic asides stripped
  const names = new Set();
  try {
    const { lines, active } = readMasked(path);
    for (let i = 0; i < lines.length; i++) {
      if (!active[i]) continue;
      const m = /^#{2,3} (.*\S)$/.exec(lines[i]);
      if (!m) continue;
      const name = m[1].trim().replace(HEADING_SUFFIX_RE, '');
      const legacy = LEGACY_ID_RE.exec(name);
      if (legacy && legacy[4]) names.add(legacy[4].trim());
      names.add(name);
    }
  } catch {
    /* unreadable -> empty */
  }
  return names;
}

export function invariantReferenceSlugs(path) {
  const names = isCanonicalShaped(path)
    ? canonicalAllRecords(path).map((record) => record.name)
    : [...contractNames(path)];
  return new Set(names.map(invariantHeadingSlug));
}

// ---------------------------------------------------------------------------
// filesystem walking

const COVERAGE_COUNTS = { unreferenced: 0, exempt: 0 };
const SKIPPED_CHECKOUTS = new Set();
const SKIPPED_SYMLINKS = new Set();
const SKIPPED_LARGE = new Set();
const SKIPPED_GITIGNORED = new Set();

function* walk(dir, root = dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) {
      SKIPPED_SYMLINKS.add(p);
      continue;
    }
    const relativePath = relative(root, p).replaceAll('\\', '/');
    if (e.isDirectory()) {
      if (ignoredDirectories(root).has(relativePath)) continue;
      if (gitIgnoredPaths(root).directories.has(relativePath)) {
        SKIPPED_GITIGNORED.add(p);
        continue;
      }
      // a nested directory with its own .git is another checkout (worktree/vendored
      // clone) — its files shadow this checkout's reality; skip it loudly
      if (existsSync(join(p, '.git'))) {
        SKIPPED_CHECKOUTS.add(p);
        continue;
      }
      yield* walk(p, root);
    } else if (e.isFile()) {
      if (gitIgnoredPaths(root).files.has(relativePath)) {
        SKIPPED_GITIGNORED.add(p);
        continue;
      }
      yield p;
    }
  }
}

function reportSkipsAndNearMisses(root) {
  for (const p of SKIPPED_CHECKOUTS) {
    console.log(`note: skipped nested checkout ${relative(root, p)}`);
  }
  for (const p of SKIPPED_SYMLINKS) {
    console.log(
      `note: symlink not followed (contracts/annotations behind it are invisible): ${relative(root, p)}`,
    );
  }
  for (const p of SKIPPED_LARGE) {
    console.log(
      `note: file exceeds ${MAX_SCAN_BYTES} bytes — not scanned for annotations: ${relative(root, p)}`,
    );
  }
  if (SKIPPED_GITIGNORED.size > 0) {
    console.log(
      `note: ${SKIPPED_GITIGNORED.size} gitignored path(s) not scanned — no clone contains them`,
    );
  }
  SKIPPED_CHECKOUTS.clear();
  SKIPPED_SYMLINKS.clear();
  SKIPPED_LARGE.clear();
  SKIPPED_GITIGNORED.clear();
  for (const p of walk(root)) {
    const b = basename(p);
    if (
      !b.endsWith('.md') ||
      b.endsWith('.invariants.md') ||
      b.endsWith(GENERATOR_SUFFIX) ||
      b.endsWith(LEGACY_LATTICE_SUFFIX)
    )
      continue;
    // near-miss = basename that ENDS with "invariants" modulo decoration — the shape of a
    // mis-named contract ("x._invariants_.md", "x-invariants.md"), not a paper title
    const stem = b
      .slice(0, -3)
      .toLowerCase()
      .replace(/[^a-z0-9]+$/, '');
    if (stem.endsWith('invariants')) {
      console.log(
        `note: near-miss filename (looks like a contract but does not match ` +
          `*.invariants.md — NOT scanned): ${relative(root, p)}`,
      );
    }
  }
  SKIPPED_CHECKOUTS.clear();
  SKIPPED_SYMLINKS.clear();
  SKIPPED_LARGE.clear();
  SKIPPED_GITIGNORED.clear();
}

function discover(root) {
  return [...walk(root)].filter((p) => p.endsWith('.invariants.md'));
}

// ---------------------------------------------------------------------------
// generator link extraction (CommonMark-tolerant)

function extractLinks(text) {
  // Inline links: [text](target) — text may wrap lines and contain one level of nested
  // brackets; target may be <angle-bracketed> (spaces allowed) and %-encoded.
  // Reference links: [text][key], collapsed [text][], definitions [key]: <target> "title".
  const links = [];
  const defs = new Map();
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;

  for (const m of text.matchAll(
    /^[ \t]*\[([^\]]+)\]:\s*(?:<([^>\n]+)>|(\S+))(?:[ \t]+["'(].*)?$/gm,
  )) {
    defs.set(m[1].toLowerCase(), (m[2] ?? m[3]).trim());
  }
  const TEXT = '((?:[^\\[\\]]|\\[[^\\]]*\\])*)'; // one nesting level, newlines allowed
  const inline = new RegExp(
    `\\[${TEXT}\\]\\((?:<([^>\\n]*)>|([^)\\s]+))\\)`,
    'g',
  );
  for (const m of text.matchAll(inline)) {
    links.push({
      text: m[1].replace(/\s+/g, ' ').trim(),
      target: (m[2] ?? m[3]).trim(),
      line: lineOf(m.index),
    });
  }
  const refRe = new RegExp(`\\[${TEXT}\\]\\[([^\\]]*)\\]`, 'g');
  for (const m of text.matchAll(refRe)) {
    const textPart = m[1].replace(/\s+/g, ' ').trim();
    const key = (m[2] || textPart).toLowerCase();
    if (defs.has(key))
      links.push({
        text: textPart,
        target: defs.get(key),
        line: lineOf(m.index),
      });
    else
      links.push({
        text: textPart,
        target: null,
        key: m[2] || textPart,
        line: lineOf(m.index),
      });
  }
  return links;
}

function decodedLinkTarget(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function escapedRegularExpression(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskMarkdownLinks(text) {
  const maskedInlineLinks = text.replace(
    /\[((?:[^\[\]]|\[[^\]]*\])*)\]\((?:<([^>\n]*)>|([^)\s]+))\)/g,
    (match) => match.replace(/[^\n]/g, ' '),
  );
  return maskedInlineLinks.replace(
    /\[((?:[^\[\]]|\[[^\]]*\])*)\]\[([^\]]*)\]/g,
    (match) => match.replace(/[^\n]/g, ' '),
  );
}

function checkItalicRecordCitations(root, path, recordsByName, problems) {
  let text;
  try {
    const { lines, active } = readMasked(path);
    const componentLines = new Set();
    for (const record of canonicalAllRecords(path)) {
      const componentRange = record.fieldRanges.Components;
      if (!componentRange) continue;
      for (
        let line = componentRange.start;
        line <= componentRange.end;
        line++
      ) {
        componentLines.add(line);
      }
    }
    text = lines
      .map((line, index) =>
        active[index] && !componentLines.has(index + 1)
          ? stripInlineCode(line)
          : '',
      )
      .join('\n');
  } catch {
    return 0;
  }
  const searchableText = maskMarkdownLinks(text);
  let found = 0;
  for (const [name, targets] of recordsByName) {
    const flexibleName = escapedRegularExpression(name).replace(/ /g, '\\s+');
    const citationPattern = new RegExp(
      `(?<!\\*)\\*${flexibleName}\\*(?!\\*)`,
      'g',
    );
    for (const match of searchableText.matchAll(citationPattern)) {
      const line = searchableText.slice(0, match.index).split('\n').length;
      const suggestion =
        targets.length === 1
          ? (() => {
              const target = targets[0];
              const relativeTarget = relative(
                dirname(path),
                target.path,
              ).replaceAll('\\', '/');
              const linkTarget =
                target.path === path
                  ? `#${target.anchor}`
                  : `${relativeTarget}#${target.anchor}`;
              return ` use [${name}](${linkTarget})`;
            })()
          : ' link the intended record with its contract path and anchor';
      problems.push(
        `${relative(root, path)}:${line}: italic record citation '${name}' is prose, not a resolvable dependency;${suggestion}`,
      );
      found++;
    }
  }
  return found;
}

function resolveContractRecordLink(
  root,
  path,
  link,
  slugsByFile,
  globalSlugs,
  problems,
  allowSelfAnchor = false,
) {
  const where = `${relative(root, path)}:${link.line}`;
  if (link.target === null) {
    problems.push(`${where}: undefined link reference [${link.key}]`);
    return null;
  }
  const decoded = decodedLinkTarget(link.target);
  if (
    !decoded.includes('.invariants.md') &&
    !(allowSelfAnchor && decoded.startsWith('#'))
  ) {
    return null;
  }
  const [file, anchor] = decoded.split('#');
  if (!anchor) {
    problems.push(
      `${where}: contract link needs an anchor — the anchor is the reference identity`,
    );
    return null;
  }
  let target = file ? resolve(dirname(path), file) : resolve(path);
  if (!slugsByFile.has(target)) target = resolve(root, file);
  const slugs = slugsByFile.get(target);
  if (slugs === undefined) {
    problems.push(`${where}: contract not found: ${file}`);
    return null;
  }
  if (!slugs.has(anchor)) {
    const hint = slugs.has(invariantHeadingSlug(link.text))
      ? ` — did you mean '#${invariantHeadingSlug(link.text)}'?`
      : '';
    problems.push(
      `${where}: anchor '#${anchor}' does not resolve in ${file}${hint}`,
    );
    return null;
  }
  const textSlug = invariantHeadingSlug(link.text);
  if (
    /[\p{L}\p{N}]/u.test(textSlug) &&
    textSlug !== anchor &&
    globalSlugs.has(textSlug)
  ) {
    const other = globalSlugs.get(textSlug);
    problems.push(
      `${where}: link text names '${link.text}' (a record in ${relative(root, other)}) ` +
        `but the anchor points to '#${anchor}' — misleading reference`,
    );
    return null;
  }
  return { target, anchor, key: `${target}#${anchor}` };
}

// Links in any markdown file are validated. In a contract, a link inside a record's
// Components field also says that record COMPOSES the linked one.
function checkGenerator(root, path, slugsByFile, globalSlugs, problems) {
  let text;
  const componentRanges = []; // { start, end, composer }
  try {
    const { lines, active } = readMasked(path);
    text = lines
      .map((l, i) => (active[i] ? stripInlineCode(l) : ''))
      .join('\n');
    if (isCanonicalShaped(path)) {
      const [sectionBounds] = bounds(lines, active);
      const records = [
        ...parseGeneratorRecords(lines, active),
        ...(sectionBounds
          ? [
              ...parseSection(lines, active, sectionBounds[0], sectionBounds[1]),
              ...parseSection(lines, active, sectionBounds[2], sectionBounds[3]),
            ]
          : []),
      ];
      for (const record of records) {
        const range = record.fieldRanges?.Components;
        if (range) componentRanges.push({ ...range, composer: record.name });
      }
    }
  } catch {
    return { resolved: 0, referenced: new Set(), composers: new Set() };
  }
  let resolved = 0;
  const referenced = new Set();
  const composers = new Set(); // `${path} ${slug}` of records whose Components link a record
  for (const link of extractLinks(text)) {
    const where = `${relative(root, path)}:${link.line}`;
    if (link.target === null) {
      resolveContractRecordLink(
        root,
        path,
        link,
        slugsByFile,
        globalSlugs,
        problems,
      );
      continue;
    }
    const decoded = decodedLinkTarget(link.target);
    const [decodedPath] = decoded.split('#');
    const componentRange = componentRanges.find(
      (range) => link.line >= range.start && link.line <= range.end,
    );
    const isComponentLink = componentRange !== undefined;
    if (
      decodedPath.endsWith(GENERATOR_SUFFIX) ||
      decodedPath.endsWith(LEGACY_LATTICE_SUFFIX)
    ) {
      let companionTarget = resolve(dirname(path), decodedPath);
      if (!existsSync(companionTarget))
        companionTarget = resolve(root, decodedPath);
      if (!existsSync(companionTarget)) {
        problems.push(`${where}: companion not found: ${decodedPath}`);
      }
      continue;
    }
    const resolvedLink = resolveContractRecordLink(
      root,
      path,
      link,
      slugsByFile,
      globalSlugs,
      problems,
      isComponentLink || path.endsWith('.invariants.md'),
    );
    if (!resolvedLink) continue;
    resolved++;
    if (isComponentLink) {
      referenced.add(`${resolvedLink.target} ${resolvedLink.anchor}`);
      composers.add(`${resolve(path)} ${invariantHeadingSlug(componentRange.composer)}`);
    }
  }
  return { resolved, referenced, composers };
}

function checkGeneratorCompanionProse(root, path, problems) {
  if (!path.endsWith(GENERATOR_SUFFIX)) return;
  try {
    const { lines, active } = readMasked(path);
    for (let index = 0; index < lines.length; index++) {
      if (!active[index]) continue;
      if (
        /^\s*\*\*(Invariant|Scope|Mechanism|Rules out|Impossible if true|Verification|Status|Last refined):\*\*/.test(
          lines[index],
        )
      ) {
        problems.push(
          `${relative(root, path)}:${index + 1}: generator companions are prose-only (and retired); move invariant records to the contract Generator section`,
        );
      }
    }
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------------
// test-file generator headers + source tripwires

function declaredSymbolExists(text, symbolName) {
  const escapedName = symbolName.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  const declaration = new RegExp(
    '(?:class|function|interface|type|enum|namespace|const|let|var)\\s+' +
      escapedName +
      '\\b',
  );
  return declaration.test(maskTypeScriptCommentsAndStrings(text));
}

function maskTypeScriptCommentsAndStrings(text) {
  let masked = '';
  let state = 'code';
  let quote = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const nextCharacter = text[index + 1] ?? '';
    if (state === 'line-comment') {
      if (character === '\n') {
        state = 'code';
        masked += '\n';
      } else {
        masked += ' ';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && nextCharacter === '/') {
        masked += '  ';
        index++;
        state = 'code';
      } else {
        masked += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'string') {
      if (character === '\\') {
        masked += ' ';
        if (index + 1 < text.length) {
          masked += text[index + 1] === '\n' ? '\n' : ' ';
          index++;
        }
      } else if (character === quote) {
        masked += ' ';
        state = 'code';
      } else {
        masked += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (character === '/' && nextCharacter === '/') {
      masked += '  ';
      index++;
      state = 'line-comment';
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      masked += '  ';
      index++;
      state = 'block-comment';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      masked += ' ';
      quote = character;
      state = 'string';
      continue;
    }
    masked += character;
  }
  return masked;
}

function resolveTestInvariantAnnotation(root, path, annotation) {
  const contractPath = annotation.contractPath;
  let targetPath = resolve(root, contractPath);
  if (!existsSync(targetPath))
    targetPath = resolve(dirname(path), contractPath);
  if (!existsSync(targetPath)) return null;
  return `${targetPath}#${invariantHeadingSlug(annotation.name)}`;
}

function parseTestProofAnnotations(lines, headerEndLine, where, problems) {
  const proofs = [];
  let pending = [];
  let documentationCommentOpen = false;
  const flushUnbound = () => {
    for (const proof of pending) {
      problems.push(
        `${where}:${proof.line}: proof annotation must sit directly above a test`,
      );
    }
    pending = [];
    documentationCommentOpen = false;
  };
  for (let index = headerEndLine; index < lines.length; index++) {
    const line = lines[index];
    if (documentationCommentOpen) {
      if (line.includes('*/')) documentationCommentOpen = false;
      continue;
    }
    const domainMatch = DOMAIN_INVARIANT_LINE_RE.exec(line);
    if (domainMatch) {
      pending.push({
        type: 'domain',
        symbol: domainMatch[1].trim(),
        claim: domainMatch[2].trim(),
        line: index + 1,
      });
      continue;
    }
    const localNameMatch = DOMAIN_INVARIANT_TRIPWIRE_RE.exec(line);
    if (localNameMatch) {
      pending.push({
        type: 'local',
        name: localNameMatch[1].trim(),
        line: index + 1,
      });
      continue;
    }
    const impossibleMatch = IMPOSSIBLE_IF_TRUE_LINE_RE.exec(line);
    if (impossibleMatch) {
      pending.push({
        type: 'impossible',
        symbol: impossibleMatch[1].trim(),
        claim: impossibleMatch[2].trim(),
        line: index + 1,
      });
      continue;
    }
    if (RULES_OUT_KEYWORD_RE.test(line)) {
      problems.push(
        `${where}:${index + 1}: malformed rules-out proof annotation`,
      );
      continue;
    }
    const invariantMatch = [...line.matchAll(ANNOT_RE)][0];
    if (invariantMatch) {
      pending.push({
        type: 'invariant',
        name: invariantMatch[1].trim(),
        contractPath: invariantMatch[2].trim(),
        line: index + 1,
      });
      continue;
    }
    if (pending.length && /^\s*\/\*\*/.test(line)) {
      documentationCommentOpen = !line.includes('*/');
      continue;
    }
    if (pending.length && /\b(?:test|it)(?:\.[A-Za-z]+)?\s*\(/.test(line)) {
      proofs.push(...pending);
      pending = [];
      continue;
    }
    if (pending.length) flushUnbound();
  }
  if (pending.length) flushUnbound();
  return proofs;
}


// A test header is the contract grammar in the file's first block comment:
// `## Reality-based invariants` / `## Chosen invariants` sections of full records (an
// optional `## Generator` composition too). Evidence and Verification are the tests
// beneath it. The legacy two-register form (=== GENERATOR === … === GENERATOR-DESCRIBED ===)
// still passes, with a note.
const HEADER_REQUIRED = REQUIRED.filter(
  (label) => label !== 'Evidence' && label !== 'Verification',
);
const HEADER_SECTION_RE = /^[ \t]*## (?:Reality-based|Chosen|Designed) invariants[ \t]*$/m;

function headerBlock(text, anchorIndex, where, problems) {
  const blockStart = text.lastIndexOf('/*', anchorIndex);
  const blockEnd = text.indexOf('*/', anchorIndex);
  if (blockStart < 0 || blockEnd < 0) {
    problems.push(where + ': the invariant header must live inside one block comment');
    return null;
  }
  if (text.slice(0, blockStart).trim()) {
    problems.push(
      where + ': the invariant header must be the first content; imports follow it',
    );
  }
  return { blockStart, blockEnd };
}

// test path -> its header records; filled by checkRefs before the walk so that a record
// one file holds can be recognised when a SECOND file depends on it (promotion is due)
let LOCAL_RECORD_HOMES = new Map(); // record name -> [test paths]

function headerSectionLines(header) {
  const lines = header
    .slice(2, -2)
    .split('\n')
    .map((line) => line.replace(/^[ \t]+/, ''));
  const active = [];
  let fenced = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      active.push(false);
      continue;
    }
    active.push(!fenced);
  }
  // a header may omit a section it has no records for (contracts keep both headings):
  // supply the missing heading so the contract parser sees its usual shape
  const has = (heading) =>
    lines.some((line, index) => active[index] && line.trim() === heading);
  if (!has(CHOSEN) && !has(CHOSEN_ALIAS)) {
    lines.push(CHOSEN);
    active.push(true);
  }
  if (!has(REALITY)) {
    const chosenIndex = lines.findIndex(
      (line, index) => active[index] && (line.trim() === CHOSEN || line.trim() === CHOSEN_ALIAS),
    );
    lines.splice(chosenIndex, 0, REALITY);
    active.splice(chosenIndex, 0, true);
  }
  return { lines, active };
}

// the record names a section-form test header holds (empty for legacy or headerless files)
function headerRecordNames(text) {
  if (text.includes(GENERATOR_SENTINEL)) return [];
  const match = HEADER_SECTION_RE.exec(text);
  if (!match) return [];
  const blockStart = text.lastIndexOf('/*', match.index);
  const blockEnd = text.indexOf('*/', match.index);
  if (blockStart < 0 || blockEnd < 0) return [];
  const { lines, active } = headerSectionLines(text.slice(blockStart, blockEnd + 2));
  const { records } = validateContractLines(null, lines, active, HEADER_REQUIRED);
  return [...records.generator, ...records.reality, ...records.chosen]
    .filter((record) => record.name !== null)
    .map((record) => record.name);
}

function promotionHint(name, dependentPath, root) {
  const homes = (LOCAL_RECORD_HOMES.get(name) ?? []).filter(
    (home) => home !== dependentPath,
  );
  if (!homes.length) return '';
  return (
    ` — '${name}' is local to ${homes.map((home) => relative(root, home)).join(', ')}; a second` +
    ` file depending on it means it is time to promote it: move the record into a contract and` +
    ` annotate // invariant: ${name} (<contract path>)`
  );
}

// a contract record's Rules out claims, bullet by bullet (wrapped lines joined)
function contractRecordImpossibilities(contractPath, name) {
  try {
    const { lines, active } = readMasked(contractPath);
    const [sectionBounds] = bounds(lines, active);
    if (!sectionBounds) return [];
    const records = [
      ...parseGeneratorRecords(lines, active),
      ...parseSection(lines, active, sectionBounds[0], sectionBounds[1]),
      ...parseSection(lines, active, sectionBounds[2], sectionBounds[3]),
    ];
    const record = records.find((candidate) => candidate.name === name);
    return record ? fieldClaims(lines, active, record, 'Rules out') : [];
  } catch {
    return [];
  }
}

// a field's bullets, wrapped lines joined with single spaces (rewrapping never changes a
// claim); a field with no bullets is one claim
function fieldClaims(lines, active, record, label) {
  const range = record.fieldRanges?.[label];
  if (!range) return [];
  const bullets = [];
  let current = null;
  for (let index = range.start - 1; index < range.end; index++) {
    if (!active[index]) continue;
    let line = lines[index];
    if (index === range.start - 1) line = line.replace(FIELD_SHAPE_RE, '');
    line = line.trim();
    if (!line) {
      current = null;
      continue;
    }
    if (line.startsWith('- ')) current = bullets.push(line.slice(2).trim()) - 1;
    else if (current !== null) bullets[current] += ' ' + line;
  }
  if (bullets.length) return bullets;
  return record.fields[label] ? [record.fields[label]] : [];
}

function parseTestGeneratorHeader(
  root,
  path,
  text,
  problems,
  slugsByFile,
  globalSlugs,
) {
  const where = relative(root, path);
  const legacyIndex = text.indexOf(GENERATOR_SENTINEL);
  const sectionMatch = HEADER_SECTION_RE.exec(text);
  if (legacyIndex < 0 && !sectionMatch) return null;
  if (legacyIndex >= 0 && text.indexOf(GENERATOR_SENTINEL, legacyIndex + 1) >= 0) {
    problems.push(where + ': more than one generator header sentinel');
    return null;
  }
  const block = headerBlock(
    text,
    legacyIndex >= 0 ? legacyIndex : sectionMatch.index,
    where,
    problems,
  );
  if (!block) return null;
  const { blockStart, blockEnd } = block;
  const header = text.slice(blockStart, blockEnd + 2);
  const sourcePath = path.replace(/\.test\.ts$/, '.ts');
  let sourceText = '';
  if (!existsSync(sourcePath)) {
    problems.push(
      where + ': invariant header needs sibling source ' + basename(sourcePath),
    );
  } else {
    sourceText = readText(sourcePath);
  }

  // claims the tests must prove
  const domainClaims = new Map(); // legacy: `${symbol} — ${claim}`
  const domainSymbols = new Set(); // legacy symbols
  const localNames = new Set(); // record names
  const compositionNames = new Set(); // records whose Components link records: enforced through their parts
  const impossibleClaims = new Map(); // `${owner} — ${text}` -> text
  const impossibleTexts = new Set(); // legacy: owner-free texts
  let claimLinkText = '';
  const isLegacy = legacyIndex >= 0;

  if (isLegacy) {
    LEGACY_TEST_HEADERS.add(where);
    const generatorHeadingIndex = header.indexOf(GENERATOR_SENTINEL);
    const describedHeadingIndex = header.indexOf(GENERATOR_DESCRIBED_SENTINEL);
    if (describedHeadingIndex < 0) {
      problems.push(
        where +
          ': legacy generator header needs === GENERATOR-DESCRIBED === — or write the header as' +
          ' contract sections (## Reality-based invariants / ## Chosen invariants) with no marker',
      );
      return null;
    }
    if (describedHeadingIndex < generatorHeadingIndex) {
      problems.push(
        where + ': === GENERATOR-DESCRIBED === must follow === GENERATOR ===',
      );
      return null;
    }
    const formalBody = header.slice(
      generatorHeadingIndex + GENERATOR_SENTINEL.length,
      describedHeadingIndex,
    );
    if (!/^\s*Goal:\s*\S/m.test(formalBody)) {
      problems.push(where + ': formal generator register needs Goal');
    }
    for (const line of formalBody.split('\n')) {
      const match = DOMAIN_INVARIANT_LINE_RE.exec(line);
      if (match) {
        const symbolName = match[1].trim();
        const claim = match[2].trim();
        domainClaims.set(`${symbolName} — ${claim}`, { symbolName, claim });
        domainSymbols.add(symbolName);
        if (sourceText && !declaredSymbolExists(sourceText, symbolName)) {
          problems.push(
            where +
              ": local-invariant symbol '" +
              symbolName +
              "' is not declared in sibling " +
              basename(sourcePath),
          );
        }
        continue;
      }
      if (LOCAL_INVARIANT_KEYWORD_RE.test(line)) {
        problems.push(where + ': malformed local-invariant line in formal register');
      }
    }
    for (const match of formalBody.matchAll(/^\s*Impossible if true:\s*(.+\S)\s*$/gm)) {
      impossibleTexts.add(match[1].trim());
    }
    if (impossibleTexts.size === 0) {
      problems.push(where + ': formal generator register needs Impossible if true');
    }
    claimLinkText = formalBody;
  } else {
    // contract sections inside the comment: the same grammar, the same validator
    const { lines, active } = headerSectionLines(header);
    const result = validateContractLines(null, lines, active, HEADER_REQUIRED);
    for (const error of result.errors) problems.push(`${where}: ${error}`);
    const records = [
      ...result.records.generator,
      ...result.records.reality,
      ...result.records.chosen,
    ].filter((record) => record.name !== null);
    const localSlugs = new Set(records.map((record) => invariantHeadingSlug(record.name)));
    for (const record of records) {
      const range = record.fieldRanges?.Components;
      if (!range) continue;
      const componentText = lines.slice(range.start - 1, range.end).join('\n');
      if (extractLinks(componentText).length) compositionNames.add(record.name);
    }
    for (const record of records) {
      localNames.add(record.name);
      for (const claim of fieldClaims(lines, active, record, 'Rules out')) {
        impossibleClaims.set(`${record.name} — ${claim}`, claim);
      }
      const componentLines = [];
      const range = record.fieldRanges?.Components;
      if (range) {
        for (let index = range.start - 1; index < range.end; index++) {
          if (active[index]) componentLines.push(lines[index]);
        }
      }
      for (const link of extractLinks(componentLines.join('\n'))) {
        if (!link.target) {
          problems.push(
            `${where}: '${record.name}' component reference has no definition: [${link.key}]`,
          );
          continue;
        }
        const target = decodedLinkTarget(link.target);
        if (target.startsWith('#')) {
          if (!localSlugs.has(target.slice(1))) {
            problems.push(
              `${where}: '${record.name}' component ${target} names no record in this header`,
            );
          }
          continue;
        }
        claimLinkText += `[${link.text}](${link.target})\n`;
      }
    }
  }

  const headerContractClaims = new Set();
  const linkedContractBySlug = new Map(); // anchor slug -> contract path
  for (const link of extractLinks(claimLinkText)) {
    const resolvedLink = resolveContractRecordLink(
      root,
      path,
      link,
      slugsByFile,
      globalSlugs,
      problems,
    );
    if (resolvedLink) {
      headerContractClaims.add(resolvedLink.key);
      linkedContractBySlug.set(resolvedLink.anchor, resolvedLink.target);
    }
  }

  const headerEndLine = text.slice(0, blockEnd + 2).split('\n').length;
  const proofs = parseTestProofAnnotations(
    text.split('\n'),
    headerEndLine,
    where,
    problems,
  );
  const proved = new Set();
  for (const proof of proofs) {
    if (proof.type === 'local') {
      if (localNames.has(proof.name)) proved.add(`local ${proof.name}`);
      else if (isLegacy && domainSymbols.has(proof.name)) {
        problems.push(
          `${where}:${proof.line}: legacy headers prove a symbol with its claim: // local-invariant: ${proof.name} — <claim>`,
        );
      } else {
        problems.push(
          `${where}:${proof.line}: annotated test names no record in the header: ${proof.name}` +
            promotionHint(proof.name, path, root),
        );
      }
      continue;
    }
    if (proof.type === 'domain') {
      const key = `${proof.symbol} — ${proof.claim}`;
      if (!isLegacy) {
        problems.push(
          `${where}:${proof.line}: '<symbol> — <claim>' annotations belong to the legacy header form; name the record: // local-invariant: <record name>`,
        );
      } else if (domainClaims.has(key)) {
        proved.add(`domain ${key}`);
      } else if (impossibleTexts.has(proof.claim)) {
        problems.push(
          `${where}:${proof.line}: impossibility labeled as an invariant: ${key}`,
        );
      } else {
        problems.push(
          `${where}:${proof.line}: annotated test claim is absent from the generator header: ${key}`,
        );
      }
      continue;
    }
    if (proof.type === 'impossible') {
      const key = `${proof.symbol} — ${proof.claim}`;
      if (isLegacy) {
        if (impossibleTexts.has(proof.claim)) {
          proved.add(`impossible ${proof.claim}`);
          if (!domainSymbols.has(proof.symbol)) {
            problems.push(
              `${where}:${proof.line}: impossible proof symbol '${proof.symbol}' is absent from the header`,
            );
          }
        } else if (domainClaims.has(key)) {
          problems.push(
            `${where}:${proof.line}: invariant labeled as an impossibility: ${key}`,
          );
        } else {
          problems.push(
            `${where}:${proof.line}: annotated impossibility is absent from the generator header: ${key}`,
          );
        }
      } else if (impossibleClaims.has(key)) {
        proved.add(`impossible ${key}`);
      } else if (linkedContractBySlug.has(invariantHeadingSlug(proof.symbol))) {
        // a promoted (or any linked) contract record: its negative tests keep their form
        const contractPath = linkedContractBySlug.get(invariantHeadingSlug(proof.symbol));
        if (!contractRecordImpossibilities(contractPath, proof.symbol).includes(proof.claim)) {
          problems.push(
            `${where}:${proof.line}: annotated impossibility is absent from ${relative(root, contractPath)}: ${key}`,
          );
        }
      } else {
        problems.push(
          `${where}:${proof.line}: annotated impossibility is absent from the header: ${key}` +
            promotionHint(proof.symbol, path, root),
        );
      }
      continue;
    }
    const key = resolveTestInvariantAnnotation(root, path, proof);
    if (key && headerContractClaims.has(key)) {
      proved.add(`contract ${key}`);
    } else {
      problems.push(
        `${where}:${proof.line}: annotated test claim is absent from the generator header: ${proof.name}`,
      );
    }
  }
  for (const name of localNames) {
    if (!proved.has(`local ${name}`)) {
      problems.push(`${where}: header record has no annotated test: ${name}`);
    }
  }
  for (const claim of domainClaims.keys()) {
    if (!proved.has(`domain ${claim}`)) {
      problems.push(`${where}: header local-invariant has no annotated test: ${claim}`);
    }
  }
  for (const key of impossibleClaims.keys()) {
    if (!proved.has(`impossible ${key}`)) {
      problems.push(`${where}: Rules out has no annotated negative test: ${key}`);
    }
  }
  for (const claim of impossibleTexts) {
    if (!proved.has(`impossible ${claim}`)) {
      problems.push(`${where}: Rules out has no annotated negative test: ${claim}`);
    }
  }
  for (const claim of headerContractClaims) {
    if (!proved.has(`contract ${claim}`)) {
      problems.push(
        `${where}: header contract-record pointer has no annotated test: ${claim.slice(claim.indexOf('#') + 1)}`,
      );
    }
  }
  return { domainSymbols, localNames, compositionNames, isLegacy };
}

function checkTypeScriptGenerator(
  root,
  path,
  text,
  problems,
  slugsByFile,
  globalSlugs,
) {
  const where = relative(root, path);
  for (const sentinel of RETIRED_SPEC_SENTINELS) {
    if (text.includes(sentinel)) {
      problems.push(`${where}: ${sentinel} is retired; tests are the spec`);
    }
  }
  if (/^\s*\/\/\s*spec:/m.test(text)) {
    problems.push(
      `${where}: // spec: rows are retired; annotate the proving test`,
    );
  }
  if (path.endsWith('.test.ts')) {
    parseTestGeneratorHeader(
      root,
      path,
      text,
      problems,
      slugsByFile,
      globalSlugs,
    );
    return;
  }
  if (text.includes(GENERATOR_SENTINEL)) {
    problems.push(
      `${where}: === GENERATOR === belongs at the top of the sibling test file`,
    );
  }
  const siblingTestPath = path.replace(/\.ts$/, '.test.ts');
  const headerProblems = [];
  let siblingHeader = null;
  if (existsSync(siblingTestPath)) {
    siblingHeader = parseTestGeneratorHeader(
      root,
      siblingTestPath,
      readText(siblingTestPath),
      headerProblems,
      slugsByFile,
      globalSlugs,
    );
  }
  const lines = text.split('\n');
  const tripwired = new Set();
  for (let index = 0; index < lines.length; index++) {
    if (!LOCAL_INVARIANT_KEYWORD_RE.test(lines[index])) continue;
    const tripwire = DOMAIN_INVARIANT_TRIPWIRE_RE.exec(lines[index]);
    if (!tripwire) {
      problems.push(
        `${where}:${index + 1}: source local-invariant tripwires carry only the record name (or legacy symbol)`,
      );
      continue;
    }
    const name = tripwire[1].trim();
    tripwired.add(name);
    if (
      !siblingHeader?.localNames.has(name) &&
      !siblingHeader?.domainSymbols.has(name)
    ) {
      problems.push(
        `${where}:${index + 1}: source local-invariant '${name}' has no header claim in ${basename(siblingTestPath)}` +
          promotionHint(name, siblingTestPath, root),
      );
    }
  }
  if (siblingHeader && !siblingHeader.isLegacy) {
    const untripwired = [...siblingHeader.localNames].filter(
      (name) => !tripwired.has(name) && !siblingHeader.compositionNames.has(name),
    );
    if (untripwired.length) {
      console.log(
        `note: ${where}: header records with no tripwire at an enforcement point: ${untripwired.join(' · ')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// --refs: annotations + generators + coverage

function checkRefs(root) {
  // per contract: precise records if canonical-shaped (broken canonical files yield
  // EMPTY sets — never the loose harvest), loose heading harvest for local formats
  const domainRecordsByFile = new Map(
    discover(root).map((p) => [resolve(p), canonicalRecords(p)]),
  );
  const recordsByFile = new Map(
    [...domainRecordsByFile].map(([path]) => [path, canonicalAllRecords(path)]),
  );
  const contracts = new Map(
    [...recordsByFile].map(([p, recs]) => [
      p,
      recs.length
        ? new Set(recs.map((r) => r.name))
        : isCanonicalShaped(p)
          ? new Set()
          : contractNames(p),
    ]),
  );
  const slugsByFile = new Map();
  const globalSlugs = new Map(); // slug -> contract path (first seen)
  const recordsByName = new Map();
  for (const [path, records] of recordsByFile) {
    const names = records.length
      ? records.map((record) => record.name)
      : [...(contracts.get(path) ?? [])];
    const slugs = new Set();
    for (const name of names) {
      const slug = invariantHeadingSlug(name);
      if (!/[\p{L}\p{N}]/u.test(slug)) continue;
      slugs.add(slug);
      if (!globalSlugs.has(slug)) globalSlugs.set(slug, path);
      const targets = recordsByName.get(name) ?? [];
      targets.push({ path, anchor: slug });
      recordsByName.set(name, targets);
    }
    slugsByFile.set(path, slugs);
  }
  for (const [p, recs] of domainRecordsByFile) {
    if (!recs.length && !isCanonicalShaped(p)) {
      console.log(
        `note: local-format contract (loose heading harvest — schema and coverage ` +
          `unchecked; any ##/### heading resolves as a target): ${relative(root, p)}`,
      );
    }
  }
  const byRel = new Map([...contracts].map(([p, n]) => [relative(root, p), n]));
  const orphans = [];
  // local records by home, so a second dependent can be told to promote; a record that
  // lives in a header AND a contract is a promotion left half done
  LOCAL_RECORD_HOMES = new Map();
  for (const p of walk(root)) {
    if (!p.endsWith('.test.ts')) continue;
    let text;
    try {
      if (statSync(p).size > MAX_SCAN_BYTES) continue;
      text = readText(p);
    } catch {
      continue;
    }
    for (const name of headerRecordNames(text)) {
      const homes = LOCAL_RECORD_HOMES.get(name) ?? [];
      homes.push(p);
      LOCAL_RECORD_HOMES.set(name, homes);
      for (const target of recordsByName.get(name) ?? []) {
        orphans.push(
          `${relative(root, p)}: '${name}' lives in two homes — this header and ` +
            `${relative(root, target.path)}; finish the promotion: delete the header record, ` +
            `link the contract record from Components, and annotate its tests ` +
            `// invariant: ${name} (${relative(root, target.path)})`,
        );
      }
    }
  }
  const referenced = new Set(); // `${resolvedContractPath} ${name-or-slug}`
  let valid = 0;
  for (const p of walk(root)) {
    if (p.endsWith('.invariants.md')) continue;
    if (basename(p) === 'ibr-code-invariants-check.test.mjs') continue; // own spec's fixtures aren't annotations
    if (basename(p) === 'SKILL.md') continue; // skill docs carry instructional examples, not annotations
    let text;
    try {
      if (statSync(p).size > MAX_SCAN_BYTES) {
        SKIPPED_LARGE.add(p);
        continue;
      }
      const buf = readFileSync(p);
      if (buf.includes(0)) {
        // binary
        if (buf.includes('invariant:')) {
          console.log(
            `note: binary file contains 'invariant:' but cannot be scanned: ${relative(root, p)}`,
          );
        }
        continue;
      }
      text = buf.toString('utf-8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    } catch {
      continue;
    }
    if (p.endsWith('.ts')) {
      checkTypeScriptGenerator(
        root,
        p,
        text,
        orphans,
        slugsByFile,
        globalSlugs,
      );
    }
    if (!/(?<![\w-])invariant:/i.test(text)) continue;
    // A rendered image is OUTPUT, not annotation-bearing source: an .svg screenshot of a code
    // editor legitimately shows 'invariant:' text in its <text> cells, and hard-failing that as a
    // pathless annotation blocks every merge (observed 2026-08-10: a README screenshot of the app
    // editing its own repo turned the gate red repo-wide). Same treatment as the binary branch: a
    // visible note, never a finding.
    if (p.endsWith('.svg')) {
      console.log(
        `note: rendered image contains 'invariant:' text but is not annotation-bearing source: ${relative(root, p)}`,
      );
      continue;
    }
    const fileLines = text.split('\n');
    const active = maskInert(fileLines);
    fileLines.forEach((rawLine, idx) => {
      if (!active[idx]) return;
      const line = stripInlineCode(rawLine);
      let matchedHere = false;
      for (const m of line.matchAll(ANNOT_RE)) {
        matchedHere = true;
        const name = m[1].trim();
        const cpath = m[2].trim();
        const where = `${relative(root, p)}:${idx + 1}`;
        let targetPath = resolve(root, cpath);
        let target =
          byRel.get(cpath) !== undefined
            ? contracts.get(targetPath)
            : undefined;
        if (target === undefined) {
          const fileRelativeTargetPath = resolve(dirname(p), cpath);
          if (contracts.has(fileRelativeTargetPath)) {
            orphans.push(
              `${where}: contract path must be root-relative: ${cpath} ` +
                `(use ${relative(root, fileRelativeTargetPath)})`,
            );
            continue;
          }
        }
        if (target === undefined)
          orphans.push(`${where}: contract not found: ${cpath}`);
        else if (!target.has(name))
          orphans.push(`${where}: invariant '${name}' not found in ${cpath}`);
        else {
          valid++;
          referenced.add(`${targetPath} ${name}`);
        }
      }
      if (!matchedHere && ANNOT_LOOSE_RE.test(line)) {
        orphans.push(
          `${relative(root, p)}:${idx + 1}: annotation-shaped comment does not parse ` +
            `(target must be a (path ending in .invariants.md)) — fix it or it protects nothing`,
        );
        return;
      }
      if (
        !matchedHere &&
        !p.endsWith('.md') &&
        /(?:\/\/|#|\/\*|--|;)\s*invariant:\s*\S/i.test(line) &&
        !/[([]/.test(line)
      ) {
        orphans.push(
          `${relative(root, p)}:${idx + 1}: pathless annotation ('invariant: Name' with no ` +
            `contract path) — it validates nothing and will never be checked; add the (path.invariants.md)`,
        );
        return;
      }
    });
  }

  // generator reference validation (anchors are identity)
  const generatorProblems = [];
  const generatorReferenced = new Set();
  const generatorComposers = new Set();
  let generatorResolved = 0;
  let italicRecordCitations = 0;
  for (const p of walk(root)) {
    // contract-targeting md links are validated wherever they live (READMEs, design docs,
    // even other contracts) — a broken anchor is rot regardless of the file's name; only
    // companion files additionally get sibling coverage reporting
    if (!p.endsWith('.md')) continue;
    const b = basename(p);
    if (b === 'SKILL.md' || b === 'ibr-code-invariants-check.test.mjs') continue;
    // contracts are always read in full; any other markdown past the cap is skipped
    // loudly (multi-megabyte transcripts and logs are not documentation)
    if (!p.endsWith('.invariants.md') && statSync(p).size > MAX_SCAN_BYTES) {
      SKIPPED_LARGE.add(p);
      continue;
    }
    if (p.endsWith('.invariants.md')) {
      italicRecordCitations += checkItalicRecordCitations(
        root,
        p,
        recordsByName,
        generatorProblems,
      );
    }
    if (p.endsWith(GENERATOR_SUFFIX) || p.endsWith(LEGACY_LATTICE_SUFFIX)) {
      console.log(
        `note: retired generator companion: ${relative(root, p)}; ` +
          `fold what it carries into the records' fields`,
      );
    }
    checkGeneratorCompanionProse(root, p, generatorProblems);
    const generatorResult = checkGenerator(
      root,
      p,
      slugsByFile,
      globalSlugs,
      generatorProblems,
    );
    generatorResolved += generatorResult.resolved;
    for (const reference of generatorResult.referenced) {
      generatorReferenced.add(reference);
    }
    for (const composer of generatorResult.composers) generatorComposers.add(composer);
  }
  orphans.push(...generatorProblems);

  // Stands on: a reality record never stands on a choice (the dependency rule). Where a
  // contract has started recording Stands on, name the chosen records that record none.
  const kindsByFile = new Map();
  const kindOf = (path, anchor) => {
    if (!kindsByFile.has(path)) {
      const kinds = new Map();
      for (const { record, kind } of recordsWithKinds(path).records) {
        kinds.set(invariantHeadingSlug(record.name), kind);
      }
      kindsByFile.set(path, kinds);
    }
    return kindsByFile.get(path).get(anchor) ?? null;
  };
  for (const [p] of domainRecordsByFile) {
    const { lines, active, records } = recordsWithKinds(p);
    const standing = records.filter(({ record }) => record.fieldRanges?.['Stands on']);
    for (const { record, kind } of standing) {
      for (const link of fieldLinks(p, lines, active, record, 'Stands on')) {
        const targetKind = kindOf(link.targetPath, link.anchor);
        if (kind === 'reality' && targetKind && targetKind !== 'reality') {
          orphans.push(
            `${relative(root, p)}: reality record '${record.name}' stands on chosen record '#${link.anchor}' — reality never stands on a choice`,
          );
        }
      }
    }
    if (standing.length === 0) continue;
    const unstood = records
      .filter(({ record, kind }) => kind === 'chosen' && !record.fieldRanges?.['Stands on'])
      .map(({ record }) => record.name);
    if (unstood.length) {
      console.log(
        `note: stands-on ${relative(root, p)}: chosen records that stand on no record: ${unstood.join(' · ')}`,
      );
    }
  }

  // composition coverage: in a contract where some record composes others, name the
  // records that nothing composes (the composers themselves are the roots, not gaps)
  for (const [p, recs] of domainRecordsByFile) {
    const key = (record) => `${resolve(p)} ${invariantHeadingSlug(record.name)}`;
    const filePrefix = `${resolve(p)} `;
    if (![...generatorComposers].some((composer) => composer.startsWith(filePrefix))) continue;
    const uncomposed = recs
      .filter(
        (record) =>
          !generatorReferenced.has(`${p} ${invariantHeadingSlug(record.name)}`) &&
          !generatorComposers.has(key(record)),
      )
      .map((record) => record.name);
    if (uncomposed.length) {
      console.log(
        `composition ${relative(root, p)}: no record composes: ${uncomposed.join(' · ')}`,
      );
    }
  }

  for (const o of orphans) console.error(o);
  // coverage: canonical records never referenced by any annotation (informational).
  // File-qualified so same-named records in other contracts don't mask each other;
  // records declaring review-time Enforcement are exempt by design.
  COVERAGE_COUNTS.unreferenced = 0;
  COVERAGE_COUNTS.exempt = 0;
  for (const [p, recs] of domainRecordsByFile) {
    const exempt = recs.filter(
      (r) =>
        r.fields['Enforcement'] &&
        /review-time|no code locus/i.test(r.fields['Enforcement']),
    );
    COVERAGE_COUNTS.exempt += exempt.length;
    const unreferenced = recs
      .filter((r) => !exempt.includes(r))
      .filter((r) => !referenced.has(`${p} ${r.name}`))
      .map((r) => r.name);
    if (unreferenced.length) {
      COVERAGE_COUNTS.unreferenced += unreferenced.length;
      console.log(
        `coverage ${relative(root, p)}: no annotations reference: ${unreferenced.join(' · ')}`,
      );
    }
    if (exempt.length) {
      console.log(
        `coverage-exempt ${relative(root, p)} (Enforcement): ${exempt.map((r) => r.name).join(' · ')}`,
      );
    }
    for (const r of exempt) {
      if (
        /[\w-]+\.(js|ts|mjs|py|go|rs|sh|rb|java)\b|\//.test(
          r.fields['Mechanism'] ?? '',
        )
      ) {
        console.log(
          `note: '${r.name}' in ${relative(root, p)} claims review-time Enforcement but its ` +
            `Mechanism names code — reconcile (annotate the code, or correct the Mechanism)`,
        );
      }
    }
  }
  if (LEGACY_TEST_HEADERS.size > 0) {
    console.log(
      `note: ${LEGACY_TEST_HEADERS.size} test header(s) in the legacy Goal + GENERATOR-DESCRIBED form — ` +
        `still checked; contract sections (## Reality-based invariants / ## Chosen invariants of full records) are canonical`,
    );
    LEGACY_TEST_HEADERS.clear();
  }
  console.log(
    `${valid} annotation(s) resolved, ${generatorResolved} record link(s) resolved, ` +
      `${italicRecordCitations} italic record citation(s), ${orphans.length} problem(s)`,
  );
  return {
    code: orphans.length ? 1 : 0,
    valid,
    generatorResolved,
    italicRecordCitations,
    problems: orphans.length,
    coverage: COVERAGE_COUNTS.unreferenced,
    exempt: COVERAGE_COUNTS.exempt,
  };
}

// ---------------------------------------------------------------------------
// reporting + entry

function report(path, { status, errors, notes, summary }, strict = false) {
  if (status === 'noncanonical') {
    if (strict) {
      console.error(`FAIL ${path}: non-canonical (--strict)`);
      return true;
    }
    console.log(`SKIP ${path}: ${summary}`);
    return false;
  }
  for (const note of notes) console.log(`note ${path}: ${note}`);
  if (status === 'fail') {
    for (const error of errors) console.error(`${path}: ${error}`);
    return true;
  }
  console.log(`PASS ${path}: ${summary}`);
  return false;
}

function gitToplevel() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return process.cwd();
  }
}

const HELP = `ibr-code-invariants-check.mjs v${VERSION} — validate *.invariants.md contracts and their code annotations
Single-file Node >=18, zero dependencies. Lives inside the ibr-code-invariants skill folder;
invoke it by its real path from anywhere inside the target checkout.

Taxonomy: every invariant generates; one contract grammar at two levels. *.invariants.md holds
the architectural level. A test file's first block comment holds the implementation level: the
same sections and full records (Evidence and Verification are the tests beneath), proved by
// local-invariant: <name>, // rules-out: <name> — <text> and // invariant: annotated
tests. Every chosen record carries a Goal; reality records never do. *.generator.md is retired.

usage:
  node <path-to>/ibr-code-invariants-check.mjs PATH              validate one contract
  node <path-to>/ibr-code-invariants-check.mjs --all [ROOT]      validate every *.invariants.md
                                                        (exit 2 if none exist under ROOT)
  node <path-to>/ibr-code-invariants-check.mjs --refs [ROOT]     verify code annotations + generators
                                                        test headers, source tripwires, links,
                                                        italic record citations, and
                                                        record-membership coverage
  node <path-to>/ibr-code-invariants-check.mjs --refs-for '<Name>' [ROOT]
                                                        every code annotation + contract declaring
                                                        ONE named invariant (retirement-sweep primitive)
  --strict     with --all: non-canonical (local-format) files fail instead of skip
  --score      emit mechanical facts about the contract layer as JSON (last line) — counts
               only; scoring lives in the ibr-code-review skill
  --version    print version (for diagnosing checker/schema skew between copies)
  --help       this text

ROOT defaults to the git toplevel of the current directory (printed as "root ...");
pass it explicitly when outside a git checkout. Exit: 0 ok, 1 findings, 2 usage/IO.
CRLF/BOM normalized; fenced code blocks and HTML comments are inert; nested checkouts,
symlinks, files over 2MB, and directories listed in .invariantsignore are skipped.`;

const KNOWN_FLAGS = new Set([
  '--all',
  '--refs',
  '--refs-for',
  '--strict',
  '--help',
  '-h',
  '--version',
  '--score',
]);

// --refs-for <name>: locate every code annotation + contract that declares ONE named invariant.
// The retirement-sweep primitive — "is this invariant still witnessed in code, and where?"
function refsFor(root, targetName) {
  const wanted = targetName.trim();
  const definedIn = [];
  for (const p of discover(root)) {
    const recs = canonicalRecords(p);
    const names = recs.length
      ? recs.map((r) => r.name)
      : isCanonicalShaped(p)
        ? []
        : [...contractNames(p)];
    if (names.some((n) => n === wanted)) definedIn.push(relative(root, p));
  }
  const refs = [];
  for (const p of walk(root)) {
    if (p.endsWith('.invariants.md')) continue;
    const b = basename(p);
    if (b === 'ibr-code-invariants-check.test.mjs' || b === 'SKILL.md') continue;
    let text;
    try {
      if (statSync(p).size > MAX_SCAN_BYTES) continue;
      const buf = readFileSync(p);
      if (buf.includes(0)) continue;
      text = buf.toString('utf-8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    } catch {
      continue;
    }
    if (!/invariant:/i.test(text)) continue;
    if (p.endsWith('.svg')) continue; // rendered images are output, not annotation witnesses
    const fileLines = text.split('\n');
    const active = maskInert(fileLines);
    fileLines.forEach((rawLine, idx) => {
      if (!active[idx]) return;
      for (const m of stripInlineCode(rawLine).matchAll(ANNOT_RE)) {
        if (m[1].trim() === wanted)
          refs.push(`${relative(root, p)}:${idx + 1}  (${m[2].trim()})`);
      }
    });
  }
  console.log(`invariant: ${wanted}`);
  console.log(
    definedIn.length
      ? `  defined in: ${definedIn.join(', ')}`
      : `  (not declared in any *.invariants.md contract under this root)`,
  );
  console.log(`  code annotations: ${refs.length}`);
  for (const r of refs) console.log(`    ${r}`);
  const wantedSlug = invariantHeadingSlug(wanted);
  const definedPaths = new Set(definedIn.map((path) => resolve(root, path)));
  const dependents = [];
  for (const p of discover(root)) {
    const { lines, active, records } = recordsWithKinds(p);
    for (const { record } of records) {
      if (
        fieldLinks(p, lines, active, record, 'Stands on').some(
          (link) => link.anchor === wantedSlug && definedPaths.has(link.targetPath),
        )
      ) {
        dependents.push(`${relative(root, p)}: ${record.name}`);
      }
    }
  }
  console.log(`  stood on by: ${dependents.length}`);
  for (const dependent of dependents) console.log(`    ${dependent}`);
  if (refs.length === 0 && definedIn.length) {
    console.log(
      `  note: no code annotation witnesses this invariant. If you just removed the last, it ` +
        `survives only as chosen/reality doctrine with no code locus — flag it for a retirement sweep.`,
    );
  }
  return { code: 0, name: wanted, definedIn, refCount: refs.length };
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--') || a === '-h'));
  const positional = args.filter((a) => !flags.has(a));
  const pathArg = positional[0];

  for (const f of flags) {
    if (!KNOWN_FLAGS.has(f)) {
      console.error(
        `unknown flag: ${f} (known: ${[...KNOWN_FLAGS].join(', ')})`,
      );
      return 2;
    }
  }
  if (flags.has('--help') || flags.has('-h')) {
    console.log(HELP);
    return 0;
  }
  if (flags.has('--version')) {
    console.log(VERSION);
    return 0;
  }
  if (flags.has('--strict') && flags.has('--refs')) {
    console.log(
      'note: --strict has no effect with --refs (it applies to --all)',
    );
  }

  if (flags.has('--refs-for')) {
    const name = positional[0];
    if (!name) {
      console.error(
        "usage: ibr-code-invariants-check.mjs --refs-for '<Invariant Name>' [ROOT]",
      );
      return 2;
    }
    const root = resolve(positional[1] ?? gitToplevel());
    console.log(`root ${root}`);
    return refsFor(root, name).code;
  }

  if (flags.has('--all') || flags.has('--refs')) {
    const root = resolve(pathArg ?? gitToplevel());
    console.log(`root ${root}`);
    let code = 0;
    if (flags.has('--all')) {
      const files = discover(root);
      if (!files.length) {
        reportSkipsAndNearMisses(root);
        console.error(`no *.invariants.md files found under ${root}`);
        return 2;
      }
      let failed = 0;
      for (const f of files) {
        if (report(f, checkFile(f), flags.has('--strict'))) failed++;
      }
      code = failed ? 1 : 0;
    }
    if (flags.has('--refs')) {
      code = Math.max(code, checkRefs(root).code);
    }
    reportSkipsAndNearMisses(root);
    return code;
  }

  if (flags.has('--score')) {
    // mechanical facts about the contract layer (scoring lives in the ibr-code-review
    // skill — this emits counts, never a headline). JSON is the LAST line.
    const root = resolve(pathArg ?? gitToplevel());
    console.log(`root ${root}`);
    const files = discover(root);
    const schema = {
      pass: 0,
      skip: 0,
      fail: 0,
      records: 0,
    };
    for (const f of files) {
      const r = checkFile(f);
      if (r.status === 'pass') schema.pass++;
      else if (r.status === 'noncanonical') schema.skip++;
      else schema.fail++;
      const m = /(\d+) reality, (\d+) chosen invariants(?: \(\+(\d+) in a legacy Generator section\))?/.exec(
        r.summary ?? '',
      );
      if (m) schema.records += +m[1] + +m[2] + +(m[3] ?? 0);
    }
    const refs = files.length
      ? checkRefs(root)
      : { valid: 0, generatorResolved: 0, problems: 0, coverage: 0, exempt: 0 };
    reportSkipsAndNearMisses(root);
    console.log(
      JSON.stringify({
        version: VERSION,
        contracts: files.length,
        schema,
        annotations: refs.valid,
        generatorLinks: refs.generatorResolved,
        problems: refs.problems,
        coverageGaps: refs.coverage,
        exempt: refs.exempt,
        scored: files.length > 0,
      }),
    );
    return 0;
  }

  if (!pathArg) {
    console.error(
      'usage: ibr-code-invariants-check.mjs PATH | --all [ROOT] [--strict] | --refs [ROOT] (--help for details)',
    );
    return 2;
  }
  if (existsSync(pathArg) && statSync(pathArg).isDirectory()) {
    console.error(
      `document: '${pathArg}' is a directory — pass a contract file, or use --all ${pathArg}`,
    );
    return 2;
  }
  if (!existsSync(pathArg) || !statSync(pathArg).isFile()) {
    console.error(`document: file not found: ${pathArg}`);
    return 2;
  }
  return report(pathArg, checkFile(pathArg)) ? 1 : 0;
}

if (import.meta.main) process.exit(main());
