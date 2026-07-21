// Tests for check_invariants.mjs — run with:  node --test scripts/check_invariants.test.mjs
//
// Black-box: each test spawns the real CLI against fixtures built in a temp dir and
// asserts stdout/stderr/exit code. The suite is the executable spec of the contract
// schema; if you change the schema, change these tests in the same commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "check_invariants.mjs");

function run(args, cwd) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "invcheck-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const record = (name, fields = {}) => {
  const f = {
    Invariant: "If conditions hold, then behavior follows.",
    Scope: "The test scope.",
    Mechanism: "The bridge.",
    Evidence: "A test.",
    "Impossible if true": "The negative boundary.",
    Verification: "Run the suite.",
    Status: "provisional",
    "Last refined": "2026-07-19",
    ...fields,
  };
  const body = Object.entries(f)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `**${k}:** ${v}`)
    .join("\n\n");
  return `### ${name}\n\n${body}\n`;
};

const contract = (realityRecords, chosenRecords, { chosenHeading = "## Chosen invariants" } = {}) =>
  `# Test contract\n\n## Reality-based invariants\n\n${realityRecords.join("\n")}\n${chosenHeading}\n\n${chosenRecords.join("\n")}`;

// ---------- schema validation ----------

test("canonical contract passes", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("The Constraint")], [record("The Discipline")]));
  const r = run([p]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /PASS .*1 reality, 1 chosen invariants/);
  cleanup();
});

test("legacy '## Designed invariants' heading accepted", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("A")], [record("B")], { chosenHeading: "## Designed invariants" }));
  assert.equal(run([p]).code, 0);
  cleanup();
});

test("optional fields accepted; Components and Generates tolerated", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract(
    [record("A", { "Renegotiable at": "consumer contract", Components: "x — part. y — part.", Generates: "guards",
      "Rejected alternatives": "ports for isolation — cookie jars key on hostname.", "Open question": "does this hold under ipv6?" })],
    [record("B", { Generates: "discipline" })]));
  const r = run([p]);
  assert.equal(r.code, 0);
  cleanup();
});

test("missing required fields, bad status, bad date each named", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract(
    [record("Broken", { Scope: null, Mechanism: null, Status: "speculative", "Last refined": "July 19" })],
    [record("Fine")]));
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
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("A")], [record("B", { "Renegotiable at": "elsewhere" })]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'B': 'Renegotiable at' is only valid on reality records/);
  cleanup();
});

test("unknown field is flagged", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("A", { Vibe: "immaculate" })], [record("B")]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'A': unknown field 'Vibe'/);
  cleanup();
});

test("duplicate names fail", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("Same Name")], [record("Same Name")]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Same Name': duplicate invariant name/);
  cleanup();
});

test("legacy numbered heading passes with a migration note", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("ZZ-R001 — Old Style")], [record("B")]));
  const r = run([p]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /numbered heading — canonical style is an unnumbered name/);
  cleanup();
});

test("legacy ID letter in the wrong section is an error", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("ZZ-C001 — Misfiled")], [record("B")]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /chosen-lettered ID in the reality section/);
  cleanup();
});

test("empty category notes but passes; empty contract fails", () => {
  const { dir, cleanup } = tmp();
  const p1 = join(dir, "young.invariants.md");
  writeFileSync(p1, contract([record("A")], []));
  const r1 = run([p1]);
  assert.equal(r1.code, 0);
  assert.match(r1.stdout, /one category is empty — fine while bootstrapping/);
  const p2 = join(dir, "empty.invariants.md");
  writeFileSync(p2, contract([], []));
  assert.equal(run([p2]).code, 1);
  cleanup();
});

// ---------- discovery / --all ----------

test("--all discovers nested contracts, skips local formats and node_modules", () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, "sub/deep"), { recursive: true });
  mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
  writeFileSync(join(dir, "sub/deep/a.invariants.md"), contract([record("A")], [record("B")]));
  writeFileSync(join(dir, "local.invariants.md"), "# Narrative style\n\n## My Named Invariant\n\nProse.\n");
  writeFileSync(join(dir, "node_modules/pkg/x.invariants.md"), "junk");
  const r = run(["--all", dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /PASS .*a\.invariants\.md/);
  assert.match(r.stdout, /SKIP .*local\.invariants\.md.*local format/);
  assert.doesNotMatch(r.stdout + r.stderr, /node_modules/);
  const strict = run(["--all", dir, "--strict"]);
  assert.equal(strict.code, 1);
  assert.match(strict.stderr, /FAIL .*local\.invariants\.md: non-canonical/);
  cleanup();
});

// ---------- --refs annotation drift ----------

test("--refs resolves valid annotations, fails orphans, harvests local headings", () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, "sub"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "sub/demo.invariants.md"), contract([record("Real Rule")], [record("Held Discipline")]));
  writeFileSync(join(dir, "scripts/tool.invariants.md"),
    "# Tool — Invariants\n\n## Identity Must Reflect Reality _(the master invariant)_\n\nProse.\n");
  writeFileSync(join(dir, "sub/guard.js"), [
    "// invariant: Real Rule (sub/demo.invariants.md)",
    "// invariant: Identity Must Reflect Reality (scripts/tool.invariants.md)",
    "// invariant: Ghost Rule (sub/demo.invariants.md)",
    "// invariant: Held Discipline (missing/gone.invariants.md)",
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /2 annotation\(s\) resolved, .*2 problem\(s\)/);
  assert.match(r.stderr, /invariant 'Ghost Rule' not found in sub\/demo\.invariants\.md/);
  assert.match(r.stderr, /contract not found: missing\/gone\.invariants\.md/);
  cleanup();
});

test("--refs tolerates paths relative to the annotated file's directory", () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "sub/demo.invariants.md"), contract([record("Real Rule")], [record("B")]));
  writeFileSync(join(dir, "sub/guard.js"), "// invariant: Real Rule (demo.invariants.md)\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /1 annotation\(s\) resolved, .*0 problem\(s\)/);
  cleanup();
});

test("--refs reports canonical records with zero annotations as coverage info", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Annotated Rule")], [record("Never Referenced")]));
  writeFileSync(join(dir, "code.js"), "// invariant: Annotated Rule (demo.invariants.md)\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0); // coverage is informational, not a failure
  assert.match(r.stdout, /coverage demo\.invariants\.md: no annotations reference: Never Referenced/);
  assert.doesNotMatch(r.stdout, /no annotations reference:.*Annotated Rule/);
  cleanup();
});

test("--refs skips the checker's own test file", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("A")], [record("B")]));
  writeFileSync(join(dir, "check_invariants.test.mjs"),
    "// invariant: Ghost (sub/none.invariants.md)\n");
  writeFileSync(join(dir, "SKILL.md"),
    "// invariant: Ghost Example (sub/none.invariants.md)\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stderr, /Ghost/);
  cleanup();
});

test("--refs on a clean tree exits 0", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("A")], [record("B")]));
  writeFileSync(join(dir, "code.js"), "// no annotations here\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0);
  cleanup();
});

// ---------- lattice references ----------

test("slug collision fails; punctuated name draws charset note", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract(
    [record("Routes cannot resend"), record("Routes, cannot resend!")],
    [record("B")]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /slug collision with 'Routes cannot resend'/);
  assert.match(r.stdout, /name contains punctuation/);
  cleanup();
});

test("lattice: valid links resolve (inline, alias, reference-style), coverage reported", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract(
    [record("A non-ready route cannot transmit")], [record("Unknown usage remains unknown")]));
  writeFileSync(join(dir, "demo.lattice.md"), [
    "# How demo holds together",
    "",
    "Because [A non-ready route cannot transmit](demo.invariants.md#a-non-ready-route-cannot-transmit)",
    "and [the unknown-usage rule][uu] compose, telemetry is trustworthy.",
    "",
    "[uu]: demo.invariants.md#unknown-usage-remains-unknown",
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /2 lattice link\(s\) resolved/);
  assert.doesNotMatch(r.stdout, /coverage demo\.lattice\.md/); // all records woven
  cleanup();
});

test("lattice: missing anchor, dead anchor, undefined ref key all fail", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Rule one holds")], [record("B")]));
  writeFileSync(join(dir, "demo.lattice.md"), [
    "[Rule one holds](demo.invariants.md)",
    "[Rule one holds](demo.invariants.md#rule-one-gone)",
    "[Rule one holds][nokey]",
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /needs an anchor/);
  assert.match(r.stderr, /anchor '#rule-one-gone' does not resolve.*did you mean '#rule-one-holds'/);
  assert.match(r.stderr, /undefined link reference \[nokey\]/);
  cleanup();
});

test("lattice: verbatim-name text pointing at a different record fails; free alias passes", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract(
    [record("A non-ready route cannot transmit")], [record("Unknown usage remains unknown")]));
  writeFileSync(join(dir, "demo.lattice.md"), [
    "[A non-ready route cannot transmit](demo.invariants.md#unknown-usage-remains-unknown)",
    "[the transmit rule](demo.invariants.md#a-non-ready-route-cannot-transmit)",
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /link text names 'A non-ready route cannot transmit'.*misleading reference/);
  assert.doesNotMatch(r.stderr, /the transmit rule/);
  cleanup();
});

test("lattice: unwoven records reported as coverage, case-insensitive text tolerated", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract(
    [record("Rule one holds")], [record("Rule two holds")]));
  writeFileSync(join(dir, "demo.lattice.md"),
    "[rule one holds](demo.invariants.md#rule-one-holds)\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0); // lowercase text of the SAME record is not misleading
  assert.match(r.stdout, /coverage demo\.lattice\.md: never referenced: Rule two holds/);
  cleanup();
});

// ---------- red-team regression fixes ----------

test("impossible calendar dates fail", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, contract([record("A", { "Last refined": "2026-99-99" })], [record("B")]));
  const r = run([p]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'A': Last refined must match YYYY-MM-DD/);
  cleanup();
});

test("section headings are not valid annotation targets in canonical contracts", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Real rule")], [record("B")]));
  writeFileSync(join(dir, "pad.js"), "// invariant: Chosen invariants (demo.invariants.md)\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Chosen invariants' not found/);
  cleanup();
});

test("coverage is file-qualified: same-named records in another contract are not masked", () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, "a")); mkdirSync(join(dir, "b"));
  writeFileSync(join(dir, "a/one.invariants.md"), contract([record("Shared rule name")], [record("B")]));
  writeFileSync(join(dir, "b/two.invariants.md"), contract([record("Shared rule name")], [record("B")]));
  writeFileSync(join(dir, "guard.js"), "// invariant: Shared rule name (a/one.invariants.md)\n");
  const r = run(["--refs", dir]);
  assert.match(r.stdout, /coverage b\/two\.invariants\.md:.*Shared rule name/);
  assert.doesNotMatch(r.stdout, /coverage a\/one\.invariants\.md:.*Shared rule name/);
  cleanup();
});

test("Enforcement: review-time exempts a record from coverage", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract(
    [record("Code rule")],
    [record("Discipline rule", { Enforcement: "review-time — no code locus" })]));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /coverage demo\.invariants\.md:.*Code rule/);
  assert.doesNotMatch(r.stdout, /no annotations reference:.*Discipline rule/);
  assert.match(r.stdout, /coverage-exempt demo\.invariants\.md \(Enforcement\): Discipline rule/);
  cleanup();
});

test("near-miss filenames are flagged; paper-style titles are not", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("A")], [record("B")]));
  writeFileSync(join(dir, "pb._invariants_.md"), "# looks like a contract");
  writeFileSync(join(dir, "Invariant Theory - Paper.md"), "# a paper");
  const r = run(["--all", dir]);
  assert.match(r.stdout, /near-miss filename.*pb\._invariants_\.md/);
  assert.doesNotMatch(r.stdout, /Invariant Theory/);
  cleanup();
});

test("nested checkouts are skipped and noted", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("A")], [record("B")]));
  mkdirSync(join(dir, "vendor/other/.git"), { recursive: true });
  writeFileSync(join(dir, "vendor/other/x.invariants.md"), contract([record("A")], [record("B")]));
  const r = run(["--all", dir]);
  assert.match(r.stdout, /note: skipped nested checkout vendor\/other/);
  assert.doesNotMatch(r.stdout, /x\.invariants\.md/);
  cleanup();
});

// ---------- round-2 hardening: hostile inputs ----------

test("CRLF contracts parse identically; BOM tolerated", () => {
  const { dir, cleanup } = tmp();
  const p = join(dir, "demo.invariants.md");
  writeFileSync(p, "\ufeff" + contract([record("Real rule")], [record("B")]).replace(/\n/g, "\r\n"));
  const r = run([p]);
  assert.equal(r.code, 0);
  writeFileSync(join(dir, "g.js"), "// invariant: Real rule (demo.invariants.md)\n");
  assert.equal(run(["--refs", dir]).code, 0);
  cleanup();
});

test("fenced code blocks are inert: annotations, headings, section dupes", () => {
  const { dir, cleanup } = tmp();
  const fenced = contract([record("Real rule")], [record("B")]) + [
    "", "```markdown", "### Fake record inside fence",
    "## Reality-based invariants", "```", "",
  ].join("\n");
  writeFileSync(join(dir, "demo.invariants.md"), fenced);
  assert.equal(run([join(dir, "demo.invariants.md")]).code, 0);
  writeFileSync(join(dir, "README.md"), [
    "```js", "// invariant: Ghost (missing.invariants.md)", "```",
    "<!-- invariant: Old gone (missing.invariants.md) -->",
    "prose with \`invariant: Inline (missing.invariants.md)\` code span",
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0, r.stderr);
  cleanup();
});

test("broken canonical contract does NOT fall back to loose harvest", () => {
  const { dir, cleanup } = tmp();
  // duplicate section heading (unfenced) -> bounds fail -> canonical-shaped but broken
  writeFileSync(join(dir, "demo.invariants.md"),
    contract([record("Real rule")], [record("B")]) + "\n## Reality-based invariants\n");
  writeFileSync(join(dir, "pad.js"), "// invariant: Chosen invariants (demo.invariants.md)\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /'Chosen invariants' not found/);
  cleanup();
});

test("wrapped, nested-bracket, collapsed, titled-def, and angle-bracket links validate", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Rule one holds")], [record("Rule two holds")]));
  writeFileSync(join(dir, "demo.lattice.md"), [
    "[Rule one",
    "holds](demo.invariants.md#rule-one-BROKEN)",           // wrapped + broken anchor -> caught
    "[see [note] here](demo.invariants.md#also-broken)",     // nested brackets -> caught
    "[Rule one holds][]",                                    // collapsed ref
    "[Rule two holds](<demo.invariants.md#rule-two-holds>)", // angle-bracket target -> valid
    "",
    '[rule one holds]: demo.invariants.md#rule-one-broken-def "title here"',
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /#rule-one-BROKEN' does not resolve/);
  assert.match(r.stderr, /#also-broken' does not resolve/);
  assert.match(r.stderr, /#rule-one-broken-def' does not resolve/); // collapsed ref resolved via titled def
  assert.doesNotMatch(r.stderr, /rule-two-holds/);
  cleanup();
});

test("percent-encoded and angle-bracket spaced contract paths resolve", () => {
  const { dir, cleanup } = tmp();
  mkdirSync(join(dir, "Domain Exploration"), { recursive: true });
  writeFileSync(join(dir, "Domain Exploration/demo.invariants.md"), contract([record("Rule one holds")], [record("B")]));
  writeFileSync(join(dir, "map.lattice.md"), [
    "[Rule one holds](Domain%20Exploration/demo.invariants.md#rule-one-holds)",
    "[the rule](<Domain Exploration/demo.invariants.md#rule-one-holds>)",
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /2 lattice link\(s\) resolved/);
  cleanup();
});

test("non-Latin names slug GitHub-style, stay distinct, and anchors resolve", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"),
    contract([record("Кэш не выживает"), record("Логи не теряются")], [record("B")]));
  assert.equal(run([join(dir, "demo.invariants.md")]).code, 0);
  writeFileSync(join(dir, "demo.lattice.md"),
    "[Кэш не выживает](demo.invariants.md#кэш-не-выживает)\n");
  assert.equal(run(["--refs", dir]).code, 0);
  cleanup();
});

test("name with no sluggable characters is an error", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("→ ← ↑")], [record("B")]));
  const r = run([join(dir, "demo.invariants.md")]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no sluggable characters/);
  cleanup();
});

test("multi-line field values are read: wrapped content and label-then-newline both work", () => {
  const { dir, cleanup } = tmp();
  const rec = [
    "### Real rule", "",
    "**Invariant:**", "If conditions hold, then behavior follows.", "",
    "**Scope:** The test", "scope continues on a second line.", "",
    "**Mechanism:** m", "", "**Evidence:** e", "", "**Impossible if true:** i", "",
    "**Verification:** v", "", "**Status:** provisional", "", "**Last refined:** 2026-07-19", "",
  ].join("\n");
  writeFileSync(join(dir, "demo.invariants.md"),
    `# T\n\n## Reality-based invariants\n\n${rec}\n## Chosen invariants\n\n${record("B")}`);
  const r = run([join(dir, "demo.invariants.md")]);
  assert.equal(r.code, 0, r.stderr);
  cleanup();
});

test("wrapped Enforcement field still exempts from coverage", () => {
  const { dir, cleanup } = tmp();
  const rec = record("Discipline rule").replace("**Status:**",
    "**Enforcement:** review-time —\nno code locus, distributed discipline.\n\n**Status:**");
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Code rule")], [rec]));
  const r = run(["--refs", dir]);
  assert.doesNotMatch(r.stdout, /no annotations reference:.*Discipline rule/);
  cleanup();
});

test("malformed annotation-shaped comments are flagged, not silent", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Real rule")], [record("B")]));
  writeFileSync(join(dir, "g.js"), [
    "// invariant: Real rule (demo.invariant.md)",   // typo'd suffix
    "// invariant: Real rule [demo.invariants.md]",  // wrong brackets
  ].join("\n"));
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.equal((r.stderr.match(/annotation-shaped comment does not parse/g) || []).length, 2);
  cleanup();
});

test("skip notes print once in --refs; exclusions are exact-basename", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Real rule")], [record("B")]));
  mkdirSync(join(dir, "vendor/other/.git"), { recursive: true });
  writeFileSync(join(dir, "UPSKILL.md"), "// invariant: Ghost (missing.invariants.md)\n");
  const r = run(["--refs", dir]);
  assert.equal((r.stdout.match(/skipped nested checkout/g) || []).length, 1);
  assert.match(r.stderr, /UPSKILL\.md:1: contract not found/); // UPSKILL.md is scanned now
  cleanup();
});

test("unknown flags exit 2; --version prints a version", () => {
  assert.equal(run(["--all", "--strick"]).code, 2);
  const v = run(["--version"]);
  assert.equal(v.code, 0);
  assert.match(v.stdout, /^\d+\.\d+\.\d+/);
});

test("directory as PATH gives a directory-specific message", () => {
  const { dir, cleanup } = tmp();
  const r = run([dir]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is a directory/);
  cleanup();
});

// ---------- round-3 rotation regressions ----------

test("--all --refs in one invocation runs BOTH passes", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("A", { Scope: null })], [record("B")]));
  const r = run(["--all", "--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing or empty Scope/); // schema pass ran
  assert.match(r.stdout, /annotation\(s\) resolved/); // refs pass ran
  cleanup();
});

test("contract-targeting links in ANY md file are validated (not just .lattice.md)", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Rule one holds")], [record("B")]));
  writeFileSync(join(dir, "README.md"), "[Rule one holds](demo.invariants.md#rule-one-GONE)\n");
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /README\.md:1: anchor '#rule-one-GONE' does not resolve/);
  cleanup();
});

test("pathless annotations in code files are flagged", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Real rule")], [record("B")]));
  writeFileSync(join(dir, "g.js"), "// invariant: Real rule\n");
  writeFileSync(join(dir, "prose.md"), "the invariant: provisionality itself\n"); // md prose exempt
  const r = run(["--refs", dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /g\.js:1: pathless annotation/);
  assert.doesNotMatch(r.stderr, /prose\.md/);
  cleanup();
});

test("Enforcement exemptions are visible and Mechanism-conflict is noted", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract(
    [record("Code rule")],
    [record("Discipline rule", { Enforcement: "review-time — no locus", Mechanism: "guard in src/guard.js enforces this" })]));
  const r = run(["--refs", dir]);
  assert.match(r.stdout, /coverage-exempt demo\.invariants\.md \(Enforcement\): Discipline rule/);
  assert.match(r.stdout, /claims review-time Enforcement but its Mechanism names code/);
  cleanup();
});

test("local-format contracts draw a loose-harvest note in --refs", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "old.invariants.md"), "# Old\n\n## Some Named Rule\n\nProse.\n");
  const r = run(["--refs", dir]);
  assert.match(r.stdout, /note: local-format contract \(loose heading harvest/);
  cleanup();
});

test("--score emits JSON components as the last line; empty repo is scored:false", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("Real rule")], [record("B", { Enforcement: "review-time — no locus" })]));
  writeFileSync(join(dir, "g.js"), "// invariant: Real rule (demo.invariants.md)\n");
  const r = run(["--score", dir]);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(j.contracts, 1);
  assert.equal(j.schema.records, 2);
  assert.equal(j.annotations, 1);
  assert.equal(j.exempt, 1);
  assert.equal(j.scored, true);
  const empty = run(["--score", mkdtempSync(join(tmpdir(), "invempty-"))]);
  const je = JSON.parse(empty.stdout.trim().split("\n").pop());
  assert.equal(je.scored, false);
  cleanup();
});

// ---------- usage ----------

test("--help exits 0 and prints usage", () => {
  const r = run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /usage:/);
});

test("--all and --refs print the resolved root", () => {
  const { dir, cleanup } = tmp();
  writeFileSync(join(dir, "demo.invariants.md"), contract([record("A")], [record("B")]));
  assert.match(run(["--all", dir]).stdout, /^root /);
  assert.match(run(["--refs", dir]).stdout, /^root /);
  cleanup();
});

test("usage errors exit 2", () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(["/nonexistent/file.invariants.md"]).code, 2);
});
