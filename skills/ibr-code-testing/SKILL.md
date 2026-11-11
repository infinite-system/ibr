---
name: ibr-code-testing
description: >-
  How to write a check that proves something — a test is a spec: the invariants
  expressed for this implementation. Covers the spec discipline (one test per
  component or caveat, name = property, annotation = claim, specs grow while
  defects stay flat) and the assertion rules — smokes, probes, matrix rows,
  regression tests. Complements the /ibr-code-invariants skill — load it too when the
  test file has an invariant header: it owns the header's contract grammar and
  the checker that enforces it. Use when authoring or reviewing any test, smoke, harness probe,
  or verification section of a report. Every rule here was bought by a real
  failure.
---

# ibr-code-testing — writing checks that can actually fail

Every rule below comes from a real incident. Extend this file only for a
failure that actually happened, never for taste.

**Load `/ibr-code-invariants` too** when the test file has an invariant header, or you
are about to write one. That skill defines the header — the contract grammar
in the file's first block comment: `## Reality-based invariants` and
`## Chosen invariants` of full records, a Goal on every chosen record — and its
checker enforces the first
section below. Every other section stands on its own. The checker enforces
headers in TypeScript test files (`X.test.ts`) only; elsewhere the discipline
is the same but unenforced.

## A test is a spec — the invariants expressed for this implementation

The invariant header at the top of a test file (`X.test.ts`, `x_test.go`,
`test_x.py` — form: `/ibr-code-invariants`, "How invariants compose") states the
claims. The tests beneath it are the spec: the invariants expressed for this
implementation. The two prove each other, and the checker holds both
directions.

- **Records.** Every record in the header, and every contract record its
  components link, has at least one test, annotated with the record's name.
  A record with no test is unproven; a test whose claim is not in the header
  is an unexplained assertion. Both are findings.
- **Caveats.** A record's Mechanism carries the caveats
  that narrow the possibility space to this implementation ("the cache is
  keyed by path, not by content"; "resets are for tests only"). A caveat
  that constrains behavior needs a test. A caveat without a test is a wish.
- **Impossibilities.** Every `Rules out` line is a negative test by
  construction. Write it as one: plant the impossible state and assert the
  refusal.
- **Form.** The test name states the property as a sentence. The annotation
  directly above it names the claim it proves. There is no spec list
  anywhere else. The header's records follow the `/ibr-code-invariants` bar: a record
  name and Invariant that would fit another file with the file name swapped
  are not this file's, a chosen record without a Goal cannot be judged, and
  prose that fits every file belongs in none.
- **Prose.** When the test code does not make the spec obvious (why this
  boundary, why this fixture, which caveat it expresses), a doc comment
  under the annotation explains it. Every sentence of that comment derives
  from the header: a comment that introduces a claim absent from the
  header is the same finding as a test without a claim. There is no
  file-level spec-prose register.
- **Direction.** For new behavior, the claim comes before the
  implementation it governs (git is the witness; refinements are new
  commits, honest history). Code may come before tests — assertions prevent
  regression, they do not discover fixes. A claim that first appears
  together with its implementation is a description, not a spec.
- **Both arms live in the spec.** The impossibility test is the permanent
  red arm: it builds the approach to the forbidden state and asserts the
  refusal with its reason, for as long as the code exists — invariant and
  impossibility, the same duality as each record itself. For checks,
  parsers, and guards, keep the violating fixture in the repo: one named
  test proves the bad fixture is caught for its reason, one proves the
  clean fixture is silent, and both run on every gate. A transient plant
  (mutate, watch it go red, revert) is only for the cases where red
  requires editing shipped code; name it in the report as transient, with
  its red evidence. A transient plant where a fixture pair was possible is
  a finding.
- **Growth.** The spec count may grow only while defects stay flat. Add a
  test only when it proves a record or caveat not yet proven. When a defect
  appears, first ask which record or caveat had no spec. If none was missing,
  the invariants themselves are wrong: refine the header first, then write
  the test that proves the refinement.
- **Promotion.** When a second file needs a header record — its code
  depends on it, or its tests prove it — the record has outgrown this file:
  promote it to a contract (`/ibr-code-invariants`, "Promotion"). Its tests stay and
  keep proving it under the contract's name; that is welcome, not churn.

## Assert what the user sees

- Assert content, not chrome. A title or status label can switch while the
  body under it stays stale.
- When the claim is visual, assert the visual property itself — color,
  position, visibility — through whatever your harness exposes. A
  text-only check cannot see "the inputs lose their color".
- When the claim is about teardown or startup noise, read the raw output
  stream, not the final rendered state. Errors often print after the
  rendered view is gone.
- When the claim is a sequence, wait on the internal state; when the claim
  is "the user sees X", the final assert stays on what the user sees. A
  model-only check goes green while the view is broken.
- Know which surface owns the state. When an action changes one panel,
  page, or process, asserting a neighbouring one proves nothing.

## Born red, with the plant confirmed

- Trust a check only after it has failed on the defect it claims to catch.
  Prefer the red that stays: a committed violating fixture with a named
  catches-it test and a named clean-is-silent test, both permanent, both
  run on every gate. Only where red requires changing shipped code: plant
  the defect, watch it fail on the position or value (not on a timeout),
  remove it, watch it pass, and name the plant as transient in the report.
- Confirm the plant was applied — search for it after planting. A replace
  that silently changes nothing produces a green, worthless check.
- The red arm asserts why it failed, not just that it failed.
- A passing delete-test may mean dead code, not a working guard. Confirm
  the deleted thing was load-bearing.

## A wait is a condition that is false right now

- Before writing a wait, ask whether its condition is false at this
  moment. A wait on a value present both before and after the change is
  already satisfied and returns stale state.
- An absence wait must follow a presence wait, or it verifies nothing.
- Never widen a timeout and never pace with sleeps — both turn a defect
  into a slower version of itself. A wait that fails only under load has
  the wrong shape; the machine is not flaky.
- Compare typed values. Never pass the string `'false'` where the boolean
  `false` is meant; a coerced comparison can be true for both.

## Cover the fixture space, empty states first

- The states to cover come from the surface, not from the last failure:
  none of the thing, one, many, all removed, and re-entry after empty. A
  start-with-nothing-open path ships broken when no fixture ever starts
  with nothing open.
- Persisted state needs a second run. Run 1 exercises the reader against
  old data; only run 2 exercises what run 1 wrote.
- Check scale: drive a small fixture and a large one. Per-step work that
  should be constant must not grow with content.

## Read the command's own exit code

- `timeout cmd | tail` reports the exit code of `tail`, and `cmd && echo`
  reports the one of `echo`. Capture the command's own status, or read a
  marker the command itself wrote.
- A check that can only fail toward "pass" is decoration. Give it both
  arms: the present arm proves it can see, the absent arm proves it can be
  silent. If both arms agree, the instrument is broken — report that,
  never a number.

## Match the check to the kind of claim

- The verification set must hold a check of the same kind as the claim: a
  visual claim needs a visual assert, an input claim needs real input
  events, a persistence claim needs a second run, and a performance claim
  needs a paired measurement. A green unit-test run verifies no visual
  claim.
- Assert after every step, not only at the end. An end-state assert cannot
  say which step corrupted state that later healed itself.
- Name what the check does not cover, in one line. Silent partial coverage
  reads as total coverage.

## Self-check before shipping a new check

1. Which header record or caveat does this test prove, and is its name
   written directly above it? The counterfactual: would this test go
   red if the annotated behavior broke? If not, the annotation does not
   belong on it — an existence check proves publication at most. Read the
   record's name and Invariant alone: can you tell which mechanism they
   describe without the file name? If it is chosen, does its Goal say what
   it is for? In a composition, delete each component in your head: does
   its Invariant stop following? Does it need a claim the header does not
   carry?
2. Can you name the defect this check catches, and did you watch it catch
   it?
3. Is the observable the one a user would point at?
4. Is every wait false at the moment it starts?
5. Which empty state does this cover, and which does it skip? Say it out
   loud.
6. Whose exit code are you actually reading?
