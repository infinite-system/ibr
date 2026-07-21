#!/usr/bin/env node
// Validate invariant contract files (*.invariants.md).
//
// Canonical schema (see the skill's SKILL.md):
//   - two sections, in order: '## Reality-based invariants', '## Chosen invariants'
//     ('## Designed invariants' accepted as a legacy alias for the second section)
//   - records headed '### <Invariant Name>' — UNNUMBERED. Names are the identifiers;
//     reference invariants by name, never by number (numbers rot when contracts reorder).
//     Legacy numbered headings ('### PB-R001 — Name') still parse but draw a note.
//   - names unique per file in slug-space; field values may wrap onto following lines
//   - required fields: Invariant, Scope, Mechanism, Evidence, Impossible if true,
//     Verification, Status (provisional|established), Last refined (YYYY-MM-DD)
//   - optional fields: 'Renegotiable at' (reality records only), 'Components',
//     'Generates', 'Rejected alternatives', 'Open question', 'Enforcement' (review-time
//     enforcement declaration — records so marked are exempt from annotation coverage)
//
// Usage:
//   check_invariants.mjs PATH            validate one contract
//   check_invariants.mjs --all [ROOT]    discover and validate every *.invariants.md under
//                                        ROOT (default: git toplevel or cwd); non-canonical
//                                        files are reported and skipped, not failed;
//                                        exits 2 if zero contracts exist under ROOT
//   --strict                             with --all: non-canonical files fail instead of skip
//   check_invariants.mjs --refs [ROOT]   scan code for 'invariant: <Name> (<contract path>)'
//                                        annotations and *.lattice.md links; fail on orphans
//                                        (name, anchor, or contract path that no longer
//                                        resolves); report per-record annotation coverage
//   --version                            print checker + schema version (skew diagnosis)
//
// Exit codes: 0 all validated files pass · 1 validation errors · 2 usage/IO error.
// Requires node >= 18. No dependencies. CRLF and BOM are normalized on read; fenced code
// blocks and HTML comments are inert (headings/annotations/links inside them are ignored).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, basename } from "node:path";
import { execSync } from "node:child_process";
import process from "node:process";

const VERSION = "2.2.0"; // bump when schema fields or validation semantics change

const REALITY = "## Reality-based invariants";
const CHOSEN = "## Chosen invariants";
const CHOSEN_ALIAS = "## Designed invariants"; // legacy heading, accepted
const HEAD_RE = /^### (.*\S)$/;
const LEGACY_ID_RE = /^([A-Z][A-Z0-9]*)-([RCD])([0-9]{3})(?:\s+—\s+(.*))?$/;
const FIELD_RE = /^(?:-\s+)?\*\*?([^*:]+):\*\*?\s*(.*)$/;
const REQUIRED = ["Invariant", "Scope", "Mechanism", "Evidence", "Impossible if true",
  "Verification", "Status", "Last refined"];
const OPTIONAL = ["Renegotiable at", "Components", "Generates", "Rejected alternatives", "Open question", "Enforcement"];
const STATUSES = new Set(["established", "provisional"]);
const DATE_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".claude"]);
const ANNOT_RE = /invariant:\s*([^(\n]+?)\s*\(([^)\n]*\.invariants\.md)\)/g;
// annotation-shaped lines that DON'T parse (typo'd suffix, wrong brackets) — flagged, not silent
const ANNOT_LOOSE_RE = /invariant:\s*\S[^\n]*?[([][^)\]\n]*\.(?:md|invariants)\b[^)\]\n]*[)\]]/i;
const HEADING_SUFFIX_RE = /\s*_\(.*\)_\s*$/; // strip italic asides in local headings
const MAX_SCAN_BYTES = 2_000_000;
const NAME_CHARSET_RE = /[^A-Za-z0-9 -]/; // canonical name charset: letters/digits/spaces/hyphens

// ---------------------------------------------------------------------------
// reading + masking

function readText(path) {
  // BOM stripped, CRLF/CR normalized — Windows-edited files parse identically
  return readFileSync(path, "utf-8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
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
      if (line.includes("-->")) inComment = false;
      continue;
    }
    // same-line HTML comments: blank the commented spans but keep the line active
    let l = line;
    if (l.includes("<!--")) {
      l = l.replace(/<!--.*?-->/g, (m) => " ".repeat(m.length));
      if (l.includes("<!--")) { // comment opens and doesn't close on this line
        l = l.slice(0, l.indexOf("<!--"));
        inComment = true;
      }
      lines[i] = l; // masked copy — callers pass their own array
    }
  }
  return active;
}

function readMasked(path) {
  const lines = readText(path).split("\n");
  const active = maskInert(lines);
  return { lines, active };
}

function stripInlineCode(line) {
  // `code spans` are inert for annotation/link scanning
  return line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

// ---------------------------------------------------------------------------
// slugs

// Canonical slug: lowercase, strip everything but letters/digits (any script),
// spaces and hyphens, spaces -> dashes. Matches GitHub's rendered heading anchors.
function slugify(name) {
  return name.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replace(/ /g, "-");
}

// ---------------------------------------------------------------------------
// contract parsing + validation

function bounds(lines, active) {
  const reality = [], chosen = [];
  lines.forEach((line, i) => {
    if (!active[i]) return;
    const t = line.trim();
    if (t === REALITY) reality.push(i);
    if (t === CHOSEN || t === CHOSEN_ALIAS) chosen.push(i);
  });
  if (reality.length !== 1 || chosen.length !== 1)
    return [null, ["document: exactly one reality and one chosen (or legacy designed) heading required"]];
  if (reality[0] >= chosen[0])
    return [null, ["document: reality section must precede chosen section"]];
  let end = lines.length;
  for (let i = chosen[0] + 1; i < lines.length; i++) {
    if (active[i] && lines[i].startsWith("## ")) { end = i; break; }
  }
  return [[reality[0] + 1, chosen[0], chosen[0] + 1, end], []];
}

function parseSection(lines, active, start, end) {
  // records with multi-line field accumulation: a non-blank line that is neither a new
  // field nor a heading continues the current field (wrapped prose stays visible)
  const records = [];
  let i = start;
  while (i < end) {
    if (!active[i] || !lines[i].startsWith("### ")) { i++; continue; }
    const head = HEAD_RE.exec(lines[i]);
    if (!head) { records.push({ name: null, line: i + 1, fields: {} }); i++; continue; }
    const rec = { name: head[1].trim(), line: i + 1, fields: {} };
    i++;
    let current = null;
    while (i < end && !(active[i] && (lines[i].startsWith("### ") || lines[i].startsWith("## ")))) {
      if (active[i]) {
        const t = lines[i].trim();
        const f = FIELD_RE.exec(t);
        if (f) {
          current = f[1].trim();
          rec.fields[current] = f[2].trim();
        } else if (t && current) {
          rec.fields[current] = (rec.fields[current] ? rec.fields[current] + " " : "") + t;
        }
      }
      i++;
    }
    records.push(rec);
  }
  return records;
}

function validateRecords(records, isReality, seenNames, seenSlugs, errors, notes) {
  let count = 0;
  for (const rec of records) {
    if (rec.name === null) {
      errors.push(`document: empty invariant heading at line ${rec.line}`);
      continue;
    }
    const name = rec.name;
    const legacy = LEGACY_ID_RE.exec(name);
    if (legacy) {
      notes.push(`'${name}': numbered heading — canonical style is an unnumbered name;` +
        " reference invariants by name, not number");
      if (isReality && legacy[2] !== "R")
        errors.push(`'${name}': chosen-lettered ID in the reality section`);
      if (!isReality && legacy[2] === "R")
        errors.push(`'${name}': reality-lettered ID in the chosen section`);
    }
    if (seenNames.has(name)) errors.push(`'${name}': duplicate invariant name`);
    seenNames.add(name);
    if (!legacy && NAME_CHARSET_RE.test(name)) {
      notes.push(`'${name}': name contains punctuation — canonical charset is letters/digits/` +
        "spaces/hyphens: code annotations match byte-exactly (smart-quote/dash editor drift " +
        "creates invisible orphans), and platform heading anchors only agree on this charset");
    }
    if (!legacy && /^-|-$|--/.test(name)) {
      notes.push(`'${name}': hyphens must be word-internal (no leading/trailing/double hyphens)`);
    }
    const slug = slugify(name);
    if (!/[\p{L}\p{N}]/u.test(slug)) {
      errors.push(`'${name}': name has no sluggable characters — anchors are reference identity` +
        " and this name produces an empty one");
    } else {
      if (seenSlugs.has(slug) && seenSlugs.get(slug) !== name) {
        errors.push(`'${name}': slug collision with '${seenSlugs.get(slug)}' (both -> #${slug}) — ` +
          "anchors are reference identity, slugs must be unique per file");
      }
      seenSlugs.set(slug, name);
    }
    const fields = rec.fields;
    for (const label of REQUIRED) {
      if (!fields[label]) errors.push(`'${name}': missing or empty ${label}`);
    }
    for (const label of Object.keys(fields)) {
      if (!REQUIRED.includes(label) && !OPTIONAL.includes(label)) {
        errors.push(`'${name}': unknown field '${label}' (tolerated fields: ` +
          `${[...REQUIRED, ...OPTIONAL].join(", ")}) — if this field is from a newer schema, ` +
          `update this checker (--version prints ${VERSION})`);
      }
    }
    if (fields["Renegotiable at"] && !isReality) {
      errors.push(`'${name}': 'Renegotiable at' is only valid on reality records —` +
        " chosen invariants are renegotiable by decision at their own scope");
    }
    if (fields["Status"] && !STATUSES.has(fields["Status"]))
      errors.push(`'${name}': invalid Status (want: ${[...STATUSES].sort().join("|")})`);
    if (fields["Last refined"] && !DATE_RE.test(fields["Last refined"]))
      errors.push(`'${name}': Last refined must match YYYY-MM-DD`);
    count++;
  }
  return count;
}

function checkFile(path) {
  // Returns { status: 'pass'|'fail'|'noncanonical', errors, notes, summary }
  let lines, active;
  try {
    ({ lines, active } = readMasked(path));
  } catch (error) {
    return { status: "fail", errors: [`document: cannot read UTF-8: ${error.message}`], notes: [], summary: "" };
  }
  if (!lines.some((l, i) => active[i] && l.trim() === REALITY))
    return { status: "noncanonical", errors: [], notes: [], summary: "no canonical section headings (local format)" };
  const [sectionBounds, errors] = bounds(lines, active);
  const notes = [];
  lines.forEach((l, i) => {
    if (!active[i] && /^### \S/.test(l)) {
      notes.push(`line ${i + 1}: record-shaped heading inside a fence/comment is INERT — ` +
        "fencing a record removes it from enforcement without a visible deletion");
    }
  });
  let realityCount = 0, chosenCount = 0, summary = "";
  if (sectionBounds) {
    const seenNames = new Set();
    const seenSlugs = new Map();
    const realityRecords = parseSection(lines, active, sectionBounds[0], sectionBounds[1]);
    const chosenRecords = parseSection(lines, active, sectionBounds[2], sectionBounds[3]);
    realityCount = validateRecords(realityRecords, true, seenNames, seenSlugs, errors, notes);
    chosenCount = validateRecords(chosenRecords, false, seenNames, seenSlugs, errors, notes);
    if (realityCount + chosenCount < 1) errors.push("document: at least one invariant is required");
    else if (realityCount === 0 || chosenCount === 0)
      notes.push("one category is empty — fine while bootstrapping");
    summary = `${realityCount} reality, ${chosenCount} chosen invariants`;
  }
  return { status: errors.length ? "fail" : "pass", errors, notes, summary };
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
  } catch { return []; }
}

function isCanonicalShaped(path) {
  try {
    const { lines, active } = readMasked(path);
    return lines.some((l, i) => active[i] && l.trim() === REALITY);
  } catch { return false; }
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
      const name = m[1].trim().replace(HEADING_SUFFIX_RE, "");
      const legacy = LEGACY_ID_RE.exec(name);
      if (legacy && legacy[4]) names.add(legacy[4].trim());
      names.add(name);
    }
  } catch { /* unreadable -> empty */ }
  return names;
}

// ---------------------------------------------------------------------------
// filesystem walking

const COVERAGE_COUNTS = { unreferenced: 0, exempt: 0 };
const SKIPPED_CHECKOUTS = new Set();
const SKIPPED_SYMLINKS = new Set();
const SKIPPED_LARGE = new Set();

function* walk(dir, root = dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) { SKIPPED_SYMLINKS.add(p); continue; }
    if (e.isDirectory()) {
      // a nested directory with its own .git is another checkout (worktree/vendored
      // clone) — its files shadow this checkout's reality; skip it loudly
      if (existsSync(join(p, ".git"))) { SKIPPED_CHECKOUTS.add(p); continue; }
      yield* walk(p, root);
    } else if (e.isFile()) yield p;
  }
}

function reportSkipsAndNearMisses(root) {
  for (const p of SKIPPED_CHECKOUTS) {
    console.log(`note: skipped nested checkout ${relative(root, p)}`);
  }
  for (const p of SKIPPED_SYMLINKS) {
    console.log(`note: symlink not followed (contracts/annotations behind it are invisible): ${relative(root, p)}`);
  }
  for (const p of SKIPPED_LARGE) {
    console.log(`note: file exceeds ${MAX_SCAN_BYTES} bytes — not scanned for annotations: ${relative(root, p)}`);
  }
  SKIPPED_CHECKOUTS.clear(); SKIPPED_SYMLINKS.clear(); SKIPPED_LARGE.clear();
  for (const p of walk(root)) {
    const b = basename(p);
    if (!b.endsWith(".md") || b.endsWith(".invariants.md") || b.endsWith(".lattice.md")) continue;
    // near-miss = basename that ENDS with "invariants" modulo decoration — the shape of a
    // mis-named contract ("x._invariants_.md", "x-invariants.md"), not a paper title
    const stem = b.slice(0, -3).toLowerCase().replace(/[^a-z0-9]+$/, "");
    if (stem.endsWith("invariants")) {
      console.log(`note: near-miss filename (looks like a contract but does not match ` +
        `*.invariants.md — NOT scanned): ${relative(root, p)}`);
    }
  }
  SKIPPED_CHECKOUTS.clear(); SKIPPED_SYMLINKS.clear(); SKIPPED_LARGE.clear();
}

function discover(root) {
  return [...walk(root)].filter((p) => p.endsWith(".invariants.md"));
}

// ---------------------------------------------------------------------------
// lattice link extraction (CommonMark-tolerant)

function extractLinks(text) {
  // Inline links: [text](target) — text may wrap lines and contain one level of nested
  // brackets; target may be <angle-bracketed> (spaces allowed) and %-encoded.
  // Reference links: [text][key], collapsed [text][], definitions [key]: <target> "title".
  const links = [];
  const defs = new Map();
  const lineOf = (idx) => text.slice(0, idx).split("\n").length;

  for (const m of text.matchAll(/^[ \t]*\[([^\]]+)\]:\s*(?:<([^>\n]+)>|(\S+))(?:[ \t]+["'(].*)?$/gm)) {
    defs.set(m[1].toLowerCase(), (m[2] ?? m[3]).trim());
  }
  const TEXT = "((?:[^\\[\\]]|\\[[^\\]]*\\])*)"; // one nesting level, newlines allowed
  const inline = new RegExp(`\\[${TEXT}\\]\\((?:<([^>\\n]*)>|([^)\\s]+))\\)`, "g");
  for (const m of text.matchAll(inline)) {
    links.push({ text: m[1].replace(/\s+/g, " ").trim(), target: (m[2] ?? m[3]).trim(), line: lineOf(m.index) });
  }
  const refRe = new RegExp(`\\[${TEXT}\\]\\[([^\\]]*)\\]`, "g");
  for (const m of text.matchAll(refRe)) {
    const textPart = m[1].replace(/\s+/g, " ").trim();
    const key = (m[2] || textPart).toLowerCase();
    if (defs.has(key)) links.push({ text: textPart, target: defs.get(key), line: lineOf(m.index) });
    else links.push({ text: textPart, target: null, key: m[2] || textPart, line: lineOf(m.index) });
  }
  return links;
}

function checkLattice(root, path, slugsByFile, namesBySlugByFile, globalSlugs, problems) {
  let text;
  try {
    const { lines, active } = readMasked(path);
    text = lines.map((l, i) => (active[i] ? stripInlineCode(l) : "")).join("\n");
  } catch { return { resolved: 0 }; }
  let resolved = 0;
  const referenced = new Set();
  for (const link of extractLinks(text)) {
    const where = `${relative(root, path)}:${link.line}`;
    if (link.target === null) {
      problems.push(`${where}: undefined link reference [${link.key}]`);
      continue;
    }
    const decoded = (() => { try { return decodeURIComponent(link.target); } catch { return link.target; } })();
    if (!decoded.includes(".invariants.md")) continue;
    const [file, anchor] = decoded.split("#");
    if (!anchor) {
      problems.push(`${where}: contract link needs an anchor — the anchor is the reference identity`);
      continue;
    }
    let target = resolve(dirname(path), file);
    if (!slugsByFile.has(target)) target = resolve(root, file);
    const slugs = slugsByFile.get(target);
    if (slugs === undefined) {
      problems.push(`${where}: contract not found: ${file}`);
      continue;
    }
    if (!slugs.has(anchor)) {
      const hint = slugs.has(slugify(link.text)) ? ` — did you mean '#${slugify(link.text)}'?` : "";
      problems.push(`${where}: anchor '#${anchor}' does not resolve in ${file}${hint}`);
      continue;
    }
    const textSlug = slugify(link.text);
    if (/[\p{L}\p{N}]/u.test(textSlug) && textSlug !== anchor && globalSlugs.has(textSlug)) {
      const other = globalSlugs.get(textSlug);
      problems.push(`${where}: link text names '${link.text}' (a record in ${relative(root, other)}) ` +
        `but the anchor points to '#${anchor}' — misleading reference`);
      continue;
    }
    resolved++;
    referenced.add(`${target} ${anchor}`);
  }
  // unwoven coverage against the sibling home contract (informational, names not slugs;
  // lattice files only — other md files get link validation but no coverage duty)
  const home = path.endsWith(".lattice.md")
    ? resolve(dirname(path), basename(path).replace(/\.lattice\.md$/, ".invariants.md"))
    : null;
  const homeSlugs = home === null ? undefined : slugsByFile.get(home);
  if (homeSlugs) {
    const nameOf = namesBySlugByFile.get(home) ?? new Map();
    const unwoven = [...homeSlugs].filter((sl) => !referenced.has(`${home} ${sl}`))
      .map((sl) => nameOf.get(sl) ?? sl);
    if (unwoven.length) {
      console.log(`coverage ${relative(root, path)}: never referenced: ${unwoven.join(" · ")}`);
    }
  }
  return { resolved };
}

// ---------------------------------------------------------------------------
// --refs: annotations + lattice + coverage

function checkRefs(root) {
  // per contract: precise records if canonical-shaped (broken canonical files yield
  // EMPTY sets — never the loose harvest), loose heading harvest for local formats
  const recordsByFile = new Map(discover(root).map((p) => [resolve(p), canonicalRecords(p)]));
  const contracts = new Map([...recordsByFile].map(([p, recs]) =>
    [p, recs.length ? new Set(recs.map((r) => r.name))
      : (isCanonicalShaped(p) ? new Set() : contractNames(p))]));
  for (const [p, recs] of recordsByFile) {
    if (!recs.length && !isCanonicalShaped(p)) {
      console.log(`note: local-format contract (loose heading harvest — schema and coverage ` +
        `unchecked; any ##/### heading resolves as a target): ${relative(root, p)}`);
    }
  }
  const byRel = new Map([...contracts].map(([p, n]) => [relative(root, p), n]));
  const orphans = [];
  const referenced = new Set(); // `${resolvedContractPath} ${name-or-slug}`
  let valid = 0;
  for (const p of walk(root)) {
    if (p.endsWith(".invariants.md")) continue;
    if (basename(p) === "check_invariants.test.mjs") continue; // own spec's fixtures aren't annotations
    if (basename(p) === "SKILL.md") continue; // skill docs carry instructional examples, not annotations
    let text;
    try {
      if (statSync(p).size > MAX_SCAN_BYTES) { SKIPPED_LARGE.add(p); continue; }
      const buf = readFileSync(p);
      if (buf.includes(0)) { // binary
        if (buf.includes("invariant:")) {
          console.log(`note: binary file contains 'invariant:' but cannot be scanned: ${relative(root, p)}`);
        }
        continue;
      }
      text = buf.toString("utf-8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    } catch { continue; }
    if (!/invariant:/i.test(text)) continue;
    const fileLines = text.split("\n");
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
        let target = byRel.get(cpath) !== undefined ? contracts.get(targetPath) : undefined;
        if (target === undefined) {
          targetPath = resolve(dirname(p), cpath);
          target = contracts.get(targetPath);
        }
        if (target === undefined) orphans.push(`${where}: contract not found: ${cpath}`);
        else if (!target.has(name)) orphans.push(`${where}: invariant '${name}' not found in ${cpath}`);
        else { valid++; referenced.add(`${targetPath} ${name}`); }
      }
      if (!matchedHere && ANNOT_LOOSE_RE.test(line)) {
        orphans.push(`${relative(root, p)}:${idx + 1}: annotation-shaped comment does not parse ` +
          `(target must be a (path ending in .invariants.md)) — fix it or it protects nothing`);
        return;
      }
      if (!matchedHere && !p.endsWith(".md") && /(?:\/\/|#|\/\*|--|;)\s*invariant:\s*\S/i.test(line) && !/[([]/.test(line)) {
        orphans.push(`${relative(root, p)}:${idx + 1}: pathless annotation ('invariant: Name' with no ` +
          `contract path) — it validates nothing and will never be checked; add the (path.invariants.md)`);
        return;
      }

    });
  }

  // lattice reference validation (anchors are identity)
  const slugsByFile = new Map();
  const namesBySlugByFile = new Map();
  const globalSlugs = new Map(); // slug -> contract path (first seen)
  for (const [p] of recordsByFile) {
    const recs = recordsByFile.get(p);
    const names = recs.length ? recs.map((r) => r.name) : [...contracts.get(p)];
    const slugs = new Set();
    const nameOf = new Map();
    for (const n of names) {
      const sl = slugify(n);
      if (!/[\p{L}\p{N}]/u.test(sl)) continue;
      slugs.add(sl);
      nameOf.set(sl, n);
      if (!globalSlugs.has(sl)) globalSlugs.set(sl, p);
    }
    slugsByFile.set(p, slugs);
    namesBySlugByFile.set(p, nameOf);
  }
  const latticeProblems = [];
  let latticeResolved = 0;
  for (const p of walk(root)) {
    // contract-targeting md links are validated wherever they live (READMEs, design docs,
    // even other contracts) — a broken anchor is rot regardless of the file's name; only
    // .lattice.md files additionally get sibling coverage reporting
    if (!p.endsWith(".md")) continue;
    const b = basename(p);
    if (b === "SKILL.md" || b === "check_invariants.test.mjs") continue;
    latticeResolved += checkLattice(root, p, slugsByFile, namesBySlugByFile, globalSlugs, latticeProblems).resolved;
  }
  orphans.push(...latticeProblems);

  for (const o of orphans) console.error(o);
  // coverage: canonical records never referenced by any annotation (informational).
  // File-qualified so same-named records in other contracts don't mask each other;
  // records declaring review-time Enforcement are exempt by design.
  COVERAGE_COUNTS.unreferenced = 0; COVERAGE_COUNTS.exempt = 0;
  for (const [p, recs] of recordsByFile) {
    const exempt = recs.filter((r) => r.fields["Enforcement"] && /review-time|no code locus/i.test(r.fields["Enforcement"]));
    COVERAGE_COUNTS.exempt += exempt.length;
    const unreferenced = recs
      .filter((r) => !exempt.includes(r))
      .filter((r) => !referenced.has(`${p} ${r.name}`))
      .map((r) => r.name);
    if (unreferenced.length) {
      COVERAGE_COUNTS.unreferenced += unreferenced.length;
      console.log(`coverage ${relative(root, p)}: no annotations reference: ${unreferenced.join(" · ")}`);
    }
    if (exempt.length) {
      console.log(`coverage-exempt ${relative(root, p)} (Enforcement): ${exempt.map((r) => r.name).join(" · ")}`);
    }
    for (const r of exempt) {
      if (/[\w-]+\.(js|ts|mjs|py|go|rs|sh|rb|java)\b|\//.test(r.fields["Mechanism"] ?? "")) {
        console.log(`note: '${r.name}' in ${relative(root, p)} claims review-time Enforcement but its ` +
          `Mechanism names code — reconcile (annotate the code, or correct the Mechanism)`);
      }
    }
  }
  console.log(`${valid} annotation(s) resolved, ${latticeResolved} lattice link(s) resolved, ${orphans.length} problem(s)`);
  return { code: orphans.length ? 1 : 0, valid, latticeResolved, problems: orphans.length,
    coverage: COVERAGE_COUNTS.unreferenced, exempt: COVERAGE_COUNTS.exempt };
}

// ---------------------------------------------------------------------------
// reporting + entry

function report(path, { status, errors, notes, summary }, strict = false) {
  if (status === "noncanonical") {
    if (strict) {
      console.error(`FAIL ${path}: non-canonical (--strict)`);
      return true;
    }
    console.log(`SKIP ${path}: ${summary}`);
    return false;
  }
  for (const note of notes) console.log(`note ${path}: ${note}`);
  if (status === "fail") {
    for (const error of errors) console.error(`${path}: ${error}`);
    return true;
  }
  console.log(`PASS ${path}: ${summary}`);
  return false;
}

function gitToplevel() {
  try {
    return execSync("git rev-parse --show-toplevel", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {
    return process.cwd();
  }
}

const HELP = `check_invariants.mjs v${VERSION} — validate *.invariants.md contracts and their code annotations
Single-file Node >=18, zero dependencies. Lives inside the invariants skill folder;
invoke it by its real path from anywhere inside the target checkout.

usage:
  node <path-to>/check_invariants.mjs PATH              validate one contract
  node <path-to>/check_invariants.mjs --all [ROOT]      validate every *.invariants.md
                                                        (exit 2 if none exist under ROOT)
  node <path-to>/check_invariants.mjs --refs [ROOT]     verify code annotations + lattice
                                                        links resolve; report coverage
  --strict     with --all: non-canonical (local-format) files fail instead of skip
  --score      emit mechanical score components as JSON (last line) — facts only; the
               scoring rubric lives in the skill's references/score.md
  --version    print version (for diagnosing checker/schema skew between copies)
  --help       this text

ROOT defaults to the git toplevel of the current directory (printed as "root ...");
pass it explicitly when outside a git checkout. Exit: 0 ok, 1 findings, 2 usage/IO.
CRLF/BOM normalized; fenced code blocks and HTML comments are inert; nested checkouts,
symlinks, and files over 2MB are skipped with a note.`;

const KNOWN_FLAGS = new Set(["--all", "--refs", "--strict", "--help", "-h", "--version", "--score"]);

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--") || a === "-h"));
  const positional = args.filter((a) => !flags.has(a));
  const pathArg = positional[0];

  for (const f of flags) {
    if (!KNOWN_FLAGS.has(f)) {
      console.error(`unknown flag: ${f} (known: ${[...KNOWN_FLAGS].join(", ")})`);
      return 2;
    }
  }
  if (flags.has("--help") || flags.has("-h")) { console.log(HELP); return 0; }
  if (flags.has("--version")) { console.log(VERSION); return 0; }
  if (flags.has("--strict") && flags.has("--refs")) {
    console.log("note: --strict has no effect with --refs (it applies to --all)");
  }

  if (flags.has("--all") || flags.has("--refs")) {
    const root = resolve(pathArg ?? gitToplevel());
    console.log(`root ${root}`);
    let code = 0;
    if (flags.has("--all")) {
      const files = discover(root);
      if (!files.length) {
        reportSkipsAndNearMisses(root);
        console.error(`no *.invariants.md files found under ${root}`);
        return 2;
      }
      let failed = 0;
      for (const f of files) {
        if (report(f, checkFile(f), flags.has("--strict"))) failed++;
      }
      code = failed ? 1 : 0;
    }
    if (flags.has("--refs")) {
      code = Math.max(code, checkRefs(root).code);
    }
    reportSkipsAndNearMisses(root);
    return code;
  }

  if (flags.has("--score")) {
    // mechanical components for the invariant score (rubric lives in the skill's
    // references/score.md — this emits facts, never a headline). JSON is the LAST line.
    const root = resolve(pathArg ?? gitToplevel());
    console.log(`root ${root}`);
    const files = discover(root);
    const schema = { pass: 0, skip: 0, fail: 0, records: 0 };
    for (const f of files) {
      const r = checkFile(f);
      if (r.status === "pass") schema.pass++;
      else if (r.status === "noncanonical") schema.skip++;
      else schema.fail++;
      const m = /(\d+) reality, (\d+) chosen/.exec(r.summary ?? "");
      if (m) schema.records += (+m[1]) + (+m[2]);
    }
    const refs = files.length ? checkRefs(root) : { valid: 0, latticeResolved: 0, problems: 0, coverage: 0, exempt: 0 };
    reportSkipsAndNearMisses(root);
    console.log(JSON.stringify({ version: VERSION, contracts: files.length, schema,
      annotations: refs.valid, latticeLinks: refs.latticeResolved, problems: refs.problems,
      coverageGaps: refs.coverage, exempt: refs.exempt,
      scored: files.length > 0 }));
    return 0;
  }

  if (!pathArg) {
    console.error("usage: check_invariants.mjs PATH | --all [ROOT] [--strict] | --refs [ROOT] (--help for details)");
    return 2;
  }
  if (existsSync(pathArg) && statSync(pathArg).isDirectory()) {
    console.error(`document: '${pathArg}' is a directory — pass a contract file, or use --all ${pathArg}`);
    return 2;
  }
  if (!existsSync(pathArg) || !statSync(pathArg).isFile()) {
    console.error(`document: file not found: ${pathArg}`);
    return 2;
  }
  return report(pathArg, checkFile(pathArg)) ? 1 : 0;
}

process.exit(main());
