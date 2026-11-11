---
name: ibr-code-review
description: >-
  Review a codebase through its invariant contracts (*.invariants.md) and score it. An
  independent reviewer audits the code against every record, hunts for bugs and for
  simplicity gaps, and scores each record from 0 to 5 on six parameters; a script checks
  each level against its evidence and turns the scores and the findings into one
  percentage. Runs as a one-off generic review, or as a stored review that repeats a
  module's review profile (*.ibr-code-review.md), once or as a hill climb that fixes what
  each review finds until the score reaches a target. Also runs a self-check: the author of
  a change checks and fixes its own work before asking for an independent review. Use when
  the user says "review the invariants", "score the contracts", "run an invariants review",
  "hill climb the score", "check my work before review", "/ibr-code-review", or asks for the
  next review round, and when an agent has finished a change and is about to submit it. Load the /ibr-code-invariants skill
  too: it owns the contract format and the checker.
---

# /ibr-code-review

One review is one **round**. You, the orchestrator, prepare the round. A separate
reviewer agent audits the code against every record, hunts for bugs and simplicity gaps
in the code the contracts govern, and scores each record. You check its findings, run the
score script and report. You never score a record yourself.

A review is either **one-off**, a single generic round, or **stored**, which follows a
module's review profile (see Review profiles) and keeps its history, so rounds can be
compared. A **hill climb** repeats stored rounds, fixing what each round found, until a
round reaches the target score or stops making progress.

A **self-check** is different: the author of a change runs it on its own work before an
independent review, fixes what it finds, and has no reviewer and no score (see Self-check).

## 1. Ask first

Look for review profiles (`*.ibr-code-review.md`) in the repository, then ask in one
question:

- **Self-check, one-off or stored?** When you wrote the change under review, run a
  self-check: you cannot review your own work independently. List the profiles you found. A one-off review is generic: it
  uses no profile, keeps no history, and can review code that has no contracts yet (it
  then reports findings with no score). A stored review repeats a profile; when the
  module has none, you draft one first (see Review profiles).
- **For a stored review, one round or a hill climb?** For a climb, ask for the target
  (default 95%).
- **Which contracts?** Default: the profile's scope, or every `*.invariants.md`.
- **May a climb edit contracts?** Default: yes for adding and sharpening records, never
  for weakening or deleting them.
- **Anything to focus on or skip** (optional).

Say that a round takes an hour or more.

## 2. Prepare the round

1. Create the round folder, which must be ignored by git:
   `tmp/ibr-code-review/<profile name>/round-<N>/` for a stored review, with N one above
   that profile's highest round, or `tmp/ibr-code-review/one-off-<date>/` for a one-off.
2. Run `node <ibr-code-invariants skill>/scripts/ibr-code-invariants-check.mjs --all --refs`
   and save the output as `round-<N>/ibr-code-review-checker.txt`.
3. For a stored review, find the code nobody has reviewed yet:
   `node <this skill>/scripts/ibr-code-review-new-code.mjs --profile <profile> --previous <previous round folder>`
   (leave out `--previous` in the first round). Save the output as
   `round-<N>/ibr-code-review-new-code.txt`. It lists the code in scope that was added,
   changed, renamed or deleted since the previous round's commit, and the code outside
   the profile's scope that annotates its contracts. That second list is code that
   already belongs to the module: propose adding its paths to the profile's Scope.
4. Copy `templates/ibr-code-review-brief.md` to `round-<N>/ibr-code-review-brief.md` and
   fill in its placeholders:
   `{{ROOT}}` (the checkout), `{{HEAD}}` (the short commit), `{{CONTRACTS}}` (one per
   line), `{{SKILL}}` (this skill's folder), `{{OUT}}` (the round folder), `{{KNOWN}}`
   (one line per finding still open or waiting on a decision; "None." in round 1), and
   `{{PROFILE}}` (the profile's full text, or for a one-off, a few lines on how to run the
   tests and the app; "None." if nothing), and `{{NEW_CODE}}` (the new-code output; for a
   one-off, "Not tracked.").
5. Launch one fresh agent, in the background, on the strongest model available. Its
   whole prompt: "Read your full brief at `<path>` and follow it exactly."
6. Do not edit the checkout until the reviewer is done.

## 3. Check the findings

The reviewer can be wrong. For every `fatal` or `scoping` finding, read the code it
cites, run what it names, and set its `status` in `ibr-code-review-findings.json`:

- `open`: real and not fixed;
- `closed`: fixed, and the rule in "When a finding stops counting" is met;
- `wrong`: the reviewer was mistaken. Say why in `orchestrator_note`.

A finding you could not check stays `open`, with a note saying so. Change nothing else
in the reviewer's files. If a score looks wrong, send it back to the reviewer with your
reason.

## 4. Score

```
node <this skill>/scripts/ibr-code-review-score.mjs <round folder> --commit <HEAD> [--target 95] [--previous <earlier round folder>]
```

The script checks every level against its evidence, applies the findings rules, writes
`ibr-code-review-score.json`, and prints every adjustment with its reason. It records the
reviewer's substrate and tracked measures beside the score. For a stored review, pass the
previous round as `--previous`: the script then names every substrate component whose
version changed, and every measure that moved. If it refuses the input, send the problem back
to the reviewer.

## 5. Report

Findings first, the score second:

1. The open realistic fatal and scoping findings, one plain sentence each, with
   `file:line`.
2. The score with every adjustment, for example "92.4% (raw 96.4%, minus 4 for two open
   scoping findings)", the previous round's score, and any substrate change that could
   explain the difference. Then the tracked measures, beside the score.
3. The five weakest records, each with the parameter that pulls it down, and what would
   raise the score most.
4. The simplicity findings, each with the smallest structure that would replace it.
5. For a stored review, the new code since the last round, and any code outside the
   profile's scope that annotates its contracts, with the Scope edit you propose.
6. The decisions waiting for the user: the facts, the code, and two or three options
   with one recommended.
7. Every record added, removed or renamed since the last round, with the reason.
8. What the review did not cover.

If `project.invariants.md` lists which subsystems should have contracts, report how many
have one, beside the score and never inside it.

## 6. Review notes

Write `round-<N>/ibr-code-review-notes.md` about the review itself, not the code:

- **Verdict**: one sentence on what the review was worth.
- **Did well** and **did less well**: how the reviewer worked. Watch for known findings
  reported again, slips out of read-only, and scores that moved while the code did not.
- **Self-check gaps**: which findings should the author's self-check have caught? A
  finding a mechanical check would have caught goes into the self-check's gates.
- **Adopt**: what the next round should change. For a stored review, propose each item
  as an edit to the profile, and apply it once the user agrees. For a one-off, offer to
  save the round's way of reviewing as a new profile.
- **History**: the score of every round so far.

A score that rises while the code stays the same needs a reason: a new record that covers
a class of bug, or a new annotation at an enforcement point. Reworded prose is not one.

## The rubric

Rubric version 2. Compare scores only within one version, and state it in every report.

Each record gets a level from 0 to 5 on each parameter. Its score is the weighted average
as a percentage of 5. A parameter marked `null` (only Unity and Observed, only where
stated below) is left out and the other weights scale up. The overall score is the
average of the record scores, adjusted for open findings.

| Parameter | Weight | Question |
| --- | --- | --- |
| Verified | 25% | Did the record's check run and pass, in this review, on this commit? |
| Unity | 25% | Does the rule have one home, with every path going through it? |
| Proof | 20% | Does the evidence prove every part of the claim? |
| Falsifiable | 15% | Does "Rules out" name something a bug report could match? |
| Observed | 10% | Was the behaviour compared with an independent answer on real data? |
| Anchored | 5% | Does the code point back at the record where it enforces it? |

**Evidence rule.** A level above 2 needs evidence, as an object with the fields each
parameter names below. The script lowers a level to what its evidence supports: no
evidence means 2 at most, and each parameter's checks are listed with it. The script never
raises a level.

### Verified (25%)

Run the record's `Verification` yourself.

- **5**: it passed in this review, on the commit under review.
- **4**: it passed in this review, but on another commit or environment.
- **3**: it failed for a reason outside the record, such as an unrelated broken test.
- **2**: it is a manual inspection, and you did it.
- **1**: it cannot run as written: what it names no longer exists.
- **0**: no runnable Verification, or it failed because the claim is broken (also a
  finding).

A result from an earlier round never scores 5; this is how the score notices a record
that no longer matches the code. Evidence: `command`, `commit`, `result` (`pass` or
`fail`), `output`. A fail allows 3 at most; a pass on another commit than `--commit`
allows 4.

### Unity (25%)

A rule holds when it has exactly one home and every path to the forbidden result goes
through that home. Three things break that, and all cost the same:

- **duplication**: the rule's logic is written in a second place;
- **over-unification (forced sharing)**: the home serves callers that need different
  things, shown by a branch for one caller, a mode flag that switches the core
  behaviour off, or a caller that uses only part of it;
- **a way around**: a path reaches the forbidden result without passing through the
  home, such as a test-only helper, a raw escape hatch, a path chosen by matching a
  string, or a second entry point.

Find the home, search for duplicates, read the home for over-unification, and look for
ways around.

- **5**: one home, no duplicate, no way around, no over-unification.
- **4**: one flaw: a single duplicate, a way around closed only by convention, or a caller
  that uses part of the home.
- **3**: the logic in three places, a way around that nothing closes, or one mode flag
  or caller branch.
- **2**: four or more places, or several open ways around, flags or branches.
- **1**: every caller writes the rule again, or the home is mostly branches.
- **0**: no home can be found, or a way around was used to break the rule (also a
  finding).

One job done two ways, or two shapes of one concept bridged by an adapter, also count as
duplication. Merging duplicates into a home that needs a mode flag does not raise this
score: it trades duplication for over-unification. An option that adjusts a side detail
is fine. A way around that a test closes is not a flaw: that test is part of the
evidence. `null` when the record describes something the project does not implement,
such as a fact about the database.

Evidence: `home` (`file:line`), `searches` (each `{ query, where }`, at least one), and
`found` (each flaw as `{ kind, where, note }`, `kind` being `duplication`,
`over-unification` or `way-around`). Each flaw found lowers the maximum by one.

### Proof (20%)

Split the claim into its parts: the `Invariant`, each `Components` entry, each `Rules
out` statement. Look for a test that fails if each part breaks.

- **5**: every part has one.
- **4**: one part has none, and the record says so.
- **3**: the main claim is proven, two or more parts are not.
- **2**: evidence exists but does not show the claim, such as a test that only checks a
  function exists.
- **1**: the cited evidence cannot be found.
- **0**: no evidence cited.

Evidence: `parts`, each `{ part, test }`, with `test` set to `null` for a part not yet
proven. One unproven part allows 4 at most; two or more allow 3.

### Falsifiable (15%)

Could someone observe each `Rules out` statement and report it as a bug?

- **5**: every statement is a concrete event in the code's real names, such as "a byte
  observed on a route whose state is not `ready`".
- **4**: all concrete, but one needs interpretation.
- **3**: some concrete, some vague.
- **2**: all vague, such as "inconsistency arises".
- **1**: it only restates the invariant with "not" added.
- **0**: missing or empty.

Evidence: `bug_report`, one sentence this record would catch.

### Observed (10%)

Tests can agree with the code and both be wrong. Compare the behaviour with an answer
worked out independently, from the specification or the declaration, never from the
system's own output. For example, SQL written by hand from the declared filters, compared
with the rows the engine returns.

- **5**: compared on real or seeded data across the record's whole scope, and matched.
- **4**: compared and matched for part of the scope.
- **3**: exercised through the real path, with no independent answer to compare.
- **2**: compared only with the system's own output, which shows consistency, not
  correctness.
- **1**: tried and could not finish, for example because the environment was down.
- **0**: observable, and nobody tried.

`null` when no data can exercise the record, such as a rule that refuses input at build
time. Evidence: `comparisons`, each `{ input, expected, source, actual, matched }`; or,
for level 3, `exercised` (what you ran). A comparison that did not match allows 3 at most,
and is also a finding.

### Anchored (5%)

An annotation is a code comment naming the record, such as `// invariant: <name> (<contract>)`.
List them with `ibr-code-invariants-check.mjs --refs-for '<name>'`.

- **5**: three or more sites, or every place the `Mechanism` names.
- **4**: two sites.
- **3**: one site.
- **2**: none, but the `Mechanism` names the enforcing functions.
- **1**: annotations exist, but the code around them no longer enforces the rule.
- **0**: none, and the `Mechanism` names no code.

Evidence: `sites` (the annotated `file:line`s), and `covers_mechanism: true` when the
sites are every place the `Mechanism` names. The number of sites sets the maximum.

## How findings change the score

**Severity.** `fatal`: a claim is defeated, or real users get a wrong result. `scoping`:
the claim holds only in a narrower scope than stated, or waits on a user decision.
`flag`: a caveat that blocks nothing.

**Reach.** `realistic`: real users or real data can reach it. `contrived`: it needs input
no client sends, or a declaration nobody wrote. A contrived finding counts one severity
lower.

| Open finding | Overall score | Its record |
| --- | --- | --- |
| Fatal | capped at 85% | Proof at most 2 |
| Scoping | minus 2 points each | Proof at most 3 |
| Flag | no change | no change |

A finding that fits no record still counts: it shows a rule nobody wrote down.

**Simplicity findings.** The review also reports simplicity gaps in the code the
contracts govern, whether or not a record covers them: duplicated mechanisms, two shapes
of one concept bridged by an adapter, special cases, inconsistent rules for the same job,
dead code. One test sets the severity: does it multiply the places a future change must
touch, or force callers to work around it? If yes, it is `scoping`, because it turns into
defects as the copies drift. If no, such as dead code or a mess confined to one place, it
is a `flag`. A special case inside a record's home that the record does not explain is
`scoping` too: either the record's `Scope` is incomplete or the code is wrong.

**When a finding stops counting.** A fatal finding closes only when the defect is fixed,
a record covers that kind of bug, and that record's check has passed. Without the record,
the same kind of bug can return unnoticed. A scoping finding closes when the user has
decided and the result is fixed in code or written into the record's `Scope`. A
simplicity finding closes when it is fixed; if it revealed a mechanism, a record must
cover that mechanism too.

## Hill climb

After each round below the target:

1. For each confirmed finding that is not a decision: write a failing test, fix the
   code, run the affected suites, commit one fix per commit.
2. Leave a check behind. If no record covers the kind of bug you fixed, add one with
   `/ibr-code-invariants`.
3. Merge duplicates only when every caller can use the one home unchanged and tests show the
   same behaviour. If merging would need a flag or a caller branch, do not merge. If you
   cannot tell, ask the user.
4. Never settle a decision yourself: carry it into `{{KNOWN}}` and the report.
5. Start the next round.

Stop, and say why, when a round reaches the target; when open fatal and scoping findings
did not fall since the last round (the script prints `NOT FALLING` with `--previous`);
after five rounds; or when only decisions remain.

## Rules

- Never weaken or delete a record to raise the score. List every removed record in the
  report.
- No contracts means no score. A one-off review still reports findings; offer
  `/ibr-code-invariants --bootstrap` to write the first contract.
- Never push or merge. Commit fixes only.

## Self-check

The author's own pass over its own change, before anyone else reviews it. It removes the
cheap, obvious problems, so the independent review spends its time on what only
independence can find. It never replaces that review.

1. **Scope the change:** the author's diff against where its branch started
   (`git diff $(git merge-base <base> HEAD)..HEAD`), plus uncommitted work.
2. **Run the gates:**
   - the checker, `ibr-code-invariants-check.mjs --all --refs`, with no problem the
     change introduced;
   - the tests and typecheck for the code the change touches;
   - `/ibr-code-invariants` on the diff: no record `violated`, and no `stressed` record
     left unexamined.
3. **Ask the standards' questions of the diff:** each record's `Verification` in
   `/ibr-code-standards`, or in the project's adopted standards. Start with "Every rule has
   one home": for each rule the change touches, name its home, search for copies, and
   check the home for flags or branches added for one caller.
4. **Fix what you find yourself,** in your own code, then go back to step 2. Stop fixing
   and report an item instead when it needs a decision (a behaviour, contract or data
   change the task did not ask for), or when the same problem survives two attempts.
5. **Finish.** When every gate is green and every question is answered with no problem
   left that you could fix, the change is refined enough: recommend an independent review
   (one-off, or stored when the module has a profile). Otherwise do not recommend it yet:
   list what remains and why.

A self-check never assigns a level or a score, never closes a finding, never weakens or
rewords a record to pass, and writes nothing into the review's round folders. Its notes
stay with the author: an independent reviewer's brief never includes them, so that review
still starts fresh.

## Review profiles

A profile holds what one module's review needs and no other module shares. This skill
holds what every review shares. The profile is the module's own file, named
`<module>.ibr-code-review.md` and kept next to the contract it reviews, for example
`docs/query-engine.ibr-code-review.md` beside `docs/query-engine.invariants.md`. Copy its
sections from `templates/ibr-code-review-profile.md`:

- **Scope**: the contracts and the code they govern.
- **Substrate**: what the results depend on, and how to read each version. A query engine
  depends on its database version, collation and driver; a front end on its framework
  version and browser.
- **How to run**: tests, the app, the data, the accounts to act as.
- **Coverage dimensions**: the axes behaviour varies along, and which combinations to
  exercise.
- **How to observe**: how this module builds independent answers for Observed.
- **Tracked measures**: module-specific numbers recorded each round.
- **Walkthrough** and **Presentation**.

**A profile tracks more, and never scores differently.** It cannot change the parameters,
the weights, the level definitions or the findings rules. The score script never reads
it, and it records substrate and measures beside the score after the score is computed,
so a module cannot be scored differently even by accident. A parameter one module wants
is either good for every module, and becomes a new rubric version, or it is a tracked
measure.

**A profile says how to review, never what was found.** The reviewer reads it, so a
finding, score or conclusion in it would anchor the reviewer. Findings live in the round
folders and in `{{KNOWN}}`.

**A file first, a folder when it needs code.** A profile starts as one file. When its
review needs scripts (oracles that build independent answers, a runner for the coverage
dimensions, a page builder), it becomes a folder of the same name, next to the contract,
with the same layout as this skill and every file named after the profile:

```
docs/query-engine.ibr-code-review/
  query-engine.ibr-code-review.md                the profile
  scripts/query-engine.ibr-code-review-oracles.py
  scripts/query-engine.ibr-code-review-oracles.test.py
  scripts/query-engine.ibr-code-review-report.py
  templates/query-engine.ibr-code-review-report.html
```

The same `*.ibr-code-review.md` search finds both forms. The profile's sections name the
scripts they run: How to observe the oracles, Tracked measures the script that writes
them, Presentation the page builder.

**Profile scripts meet the review only in the round folder.** They may write
`ibr-code-review-observed/`, `ibr-code-review-measures.json`,
`ibr-code-review-substrate.json` and the review page. They never write
`ibr-code-review-score.json` or a finding's status, and a page shows the score from
`ibr-code-review-score.json` as it is, never a number of its own. So a module's scripts
can add evidence and measures but can never change a score.

**Profile scripts are code.** They follow the coding standards and have tests. An oracle
that reads its declarations wrongly would make every round's Observed level wrong at
once, so each round the reviewer also checks one oracle against the declarations it
derives from (see the brief).

**Making and keeping one.** On a module's first stored review, draft the profile from the
code: read the substrate from lockfiles, package files and containers, propose the
coverage dimensions, and ask the user to confirm before saving it. After each round,
propose the review notes' Adopt items as edits to it. The profile lives in git, so every
change to how a module is reviewed shows in a diff.

## Files

- `templates/ibr-code-review-brief.md`: the reviewer's brief, with its rules and output formats.
- `templates/ibr-code-review-profile.md`: the sections of a module's review profile, as a
  single file or as the profile file inside its folder.
- `scripts/ibr-code-review-score.mjs`: computes the score (`--help` for the formats). Tests:
  `node --test scripts/ibr-code-review-score.test.mjs`.
- `scripts/ibr-code-review-new-code.mjs`: lists the code a stored review has not seen yet
  (`--help`). Tests: `node --test scripts/ibr-code-review-new-code.test.mjs`.

Keep every round folder. Later rounds of a stored review read them for the history, the
known findings and the previous substrate.
