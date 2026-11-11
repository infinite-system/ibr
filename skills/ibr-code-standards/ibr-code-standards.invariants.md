# IBR code standards

Standards for writing code that a reader, human or AI, can trust. The reality records state
the facts the standards respond to; each chosen record is one standard, with the Goal it
serves and the facts it stands on. These standards belong to no single codebase, so each
record's Evidence is an example of what it describes. A project that adopts a standard
replaces the example with pointers into its own code. A
project adopts a standard by copying its record into its own contract, under the same
name.

## Reality-based invariants

### Copies of a rule drift apart

**Invariant:** If the same rule is written in two places, then sooner or later a change
reaches one copy and not the other, and the two disagree.

**Scope:** Any code base edited by more than one person or session over time.

**Mechanism:** A change is made where the editor is looking. Nothing ties the other copy to
it, and no review reliably finds every copy.

**Rules out:**

- Two hand-maintained copies of a rule that stay identical across years of edits without a
  test or tool binding them.

**Evidence:** Example: A permission check written in both the API and the user interface. A new role is added to the API copy; the interface copy keeps hiding the button from it.

**Verification:** Inspection: for a rule found in two places, compare their git histories.

**Status:** established

**Last refined:** 2026-11-11

### Readers rebuild what the code does not say

**Invariant:** If a name or comment does not state what a thing is, then every reader
reconstructs it from context, and different readers reconstruct it differently.

**Scope:** Every identifier, comment and template binding a person or an AI reads.

**Mechanism:** Meaning that is not written down has to be inferred. Inference takes time
and varies between readers.

**Rules out:**

- A file where `c` means cell in one method and column in the next, read without
  confusion by someone new to it.

**Evidence:** Example: A spreadsheet module where `c` is a cell in one method and a column in the next. Every reader works out which from the surrounding lines, and some guess wrong.

**Verification:** Inspection.

**Status:** established

**Last refined:** 2026-11-11

### One dependent cannot show what is shared

**Invariant:** If only one place needs a piece of code, then nothing yet shows which part of it is common and which part belongs to that one place.

**Scope:** Any decision to extract shared code.

**Mechanism:** What is shared is what two needs have in common. With one need there is nothing to compare, so the shared part is a guess.

**Rules out:**

- An abstraction written for one caller that a second caller later uses unchanged, every time.

**Evidence:** Example: A date helper written for one report. The second report needs another time zone, and the helper grows a flag for it.

**Verification:** Inspection: compare an abstraction's first and second callers.

**Status:** established

**Last refined:** 2026-11-11

### A change to a layer reaches everything above it

**Invariant:** If code in one layer changes, then everything built on that layer can be affected.

**Scope:** Systems built in layers, where higher layers depend on lower ones.

**Mechanism:** Each layer is a dependency of the layers above it.

**Rules out:**

- A change to a shared core that no module above it could notice.

**Evidence:** Example: A time-zone rule added to the database client changes every query that runs through it, not just the one report that needed it.

**Verification:** Inspection: list the dependents of the changed layer.

**Status:** established

**Last refined:** 2026-11-11

### A guarantee covers only the paths through its check

**Invariant:** If a rule is enforced at one place, then it holds only for the paths that pass through that place.

**Scope:** Every enforced rule: types, validation, permissions, query rules.

**Mechanism:** A check sees only what reaches it. A path around it is not checked.

**Rules out:**

- A rule enforced in one function that also holds for a path that never calls it.

**Evidence:** Example: Input validated in the HTTP handler, while a batch import calls the same service directly and skips the validation.

**Verification:** Inspection: for a rule, list every path that can produce the forbidden result.

**Status:** established

**Last refined:** 2026-11-11

### Stored data outlives the code that wrote it

**Invariant:** If data is stored, then it is read back by later versions of the code than the one that wrote it.

**Scope:** Databases, saved user state, files and anything round-tripped through an API.

**Mechanism:** Code is replaced on every release; stored values stay until something migrates them.

**Rules out:**

- A stored value that only the version of the code that wrote it ever reads.

**Evidence:** Example: A saved filter stored as `{ status: 'open' }` is still read after the next release renames the field to `state`.

**Verification:** Inspection: find stored rows older than the current release.

**Status:** established

**Last refined:** 2026-11-11

### A reviewer checks only what they know changed

**Invariant:** If a change alters something its description and its visible intent do not mention, then review usually misses it.

**Scope:** Every reviewed change.

**Mechanism:** A reviewer reads the change against what it claims to do. An unmentioned effect has nothing pointing at it.

**Rules out:**

- An undeclared side effect that reviewers reliably catch.

**Evidence:** Example: A change titled "restyle the settings page" that also renames a field in an API response. Review reads the styles and approves.

**Verification:** Inspection: compare a change's description with its diff.

**Status:** established

**Last refined:** 2026-11-11

### Users act on what the interface shows

**Invariant:** If the interface shows a control as working, then users use it and expect it to work.

**Scope:** Every user-facing control.

**Mechanism:** Users cannot see behind the interface; what it shows is what they believe.

**Rules out:**

- A user who reliably ignores a control that looks live.

**Evidence:** Example: An export button rendered before its handler exists. Users click it, nothing happens, and they report their data as lost.

**Verification:** Inspection.

**Status:** established

**Last refined:** 2026-11-11

### A generic error carries only its message

**Invariant:** If code throws a generic error, then a caller can tell it apart from other errors only by parsing its message text.

**Scope:** Languages with typed exceptions or error classes.

**Mechanism:** A generic error has no type of its own to catch, so callers match on its message.

**Rules out:**

- A caller that handles one kind of generic error without reading its message.

**Evidence:** Example: A caller that retries when `error.message` contains "timeout" stops retrying the day the message is reworded.

**Verification:** Inspection.

**Status:** established

**Last refined:** 2026-11-11

### Every line costs its readers and maintainers

**Invariant:** If code exists, then every reader reads it and every change must keep it working, whether or not anything uses it.

**Scope:** All code in a codebase.

**Mechanism:** Code is read in order to change the code around it, and tested in order to keep it working.

**Rules out:**

- A line of code that costs nothing to keep.

**Evidence:** Example: An unused configuration option is still read in every review of its file and kept working in every refactor.

**Verification:** Inspection.

**Status:** established

**Last refined:** 2026-11-11

### Code shared by two jobs couples them

**Invariant:** If one piece of code serves callers that need different things, then a
change made for one caller can break another, and the code grows a branch or a flag for
each difference.

**Scope:** Shared functions, modules, components and services.

**Mechanism:** The callers share the code but not the need, so every difference between
the needs has to be settled inside the shared code.

**Rules out:**

- Shared code serving two different needs that never grows a flag or branch for either.

**Evidence:** Example: a scrollable viewport with momentum, reused by a text input that
passes `disableMomentum` and `hideScrollbar` because it needs neither.

**Verification:** Inspection: list the flags and caller-specific branches in shared code.

**Status:** established

**Last refined:** 2026-11-11

## Chosen invariants

### Every rule has one home

**Goal:** Code is written so that each rule can be found, changed and trusted in one place,
from the first line, not repaired later in review.

**Invariant:** If code implements a rule, then the rule has exactly one home, every path to
the result it forbids passes through that home, and the home serves that rule and no other
job.

**Scope:** All code, while it is written as much as when it is reviewed.

**Components:**

- [A rule is stated once and used by name](#a-rule-is-stated-once-and-used-by-name) — no
  duplication: one home, not two.
- [Shared code serves one job](#shared-code-serves-one-job) — no over-unification: the home
  is not bent to serve different needs.
- [Escape hatches are named and checked](#escape-hatches-are-named-and-checked) — no way
  around: every path goes through the home, or is named and checked.
- [Sharing waits for the second dependent](#sharing-waits-for-the-second-dependent) — when
  a home becomes shared: at the second dependent, cut at what the two have in common.

**Stands on:**

- [Copies of a rule drift apart](#copies-of-a-rule-drift-apart) — two homes drift.
- [Code shared by two jobs couples them](#code-shared-by-two-jobs-couples-them) — a home
  serving two jobs couples them.
- [A guarantee covers only the paths through its check](#a-guarantee-covers-only-the-paths-through-its-check)
  — a path around the home is not covered.

**Mechanism:** Duplication, over-unification and ways around are three failures of one
property, and fixing one by causing another does not help: merging copies into a home that
needs a mode flag trades duplication for over-unification. The way to hold all three is to
decide, before writing a rule, where its home is.

**Rules out:**

- A rule implemented in two places.
- Shared code with a flag that switches its main behaviour off for one caller.
- A path that produces a forbidden result without passing through the rule's home.

**Evidence:** Example: a text input needs the row virtualization a scrollable viewport has,
but not its momentum or its scrollbar. The shared home becomes the virtualized row list,
used by both, rather than the viewport with two flags to switch its core off.

**Verification:** Review: for each rule the change touches, name its home, the searches
for copies, any flag or caller branch in the home, and any path around it.

**Status:** established

**Last refined:** 2026-11-11

### Names unfold to the domain

**Goal:** Code reads as prose in the domain's own words, so no reader has to rebuild its
types in their head.

**Invariant:** If code declares a name, including a loop index, a callback parameter, a
destructured variable or a template binding, then the name is a word of the domain, never
a single letter or an abbreviation.

**Scope:** All code, tests included, and every template that declares a name: a Vue
`v-for` alias or slot variable, a React `.map` parameter, a Svelte `{#each}` alias, an
Angular `let` variable, a loop in a server template.

**Components:**

- **Domain words:** `row` and `column`, not `r` and `c`; `cell`, `cellValue`, `entry`,
  `versionRef`, `aggregate`, not `c`, `v`, `e`, `agg`.
- **Booleans are predicates:** `isFineTier`, `hasModel`.
- **Counts say what they count:** `observerRuns`, `releasedCount`.
- **Prior values name their role:** `originalValue` or `previousValue`, never `old` or
  `prev` alone; `newValue`, not `nv`.
- **Templates follow the same rule:** `v-for="(cell, columnIndex) in sheet.grid[row]"`,
  never `(cell, ci) in sheet.grid[r]`. The template is read by the same people as the code.
- **The one exception:** an abbreviation that is itself the domain term (`px`, `id`, `fx`,
  A1 notation such as `startRow`/`endColumn`), or the documented name of a library or
  language (`z` for Zod, a DSL's `q`).

**Stands on:**

- [Readers rebuild what the code does not say](#readers-rebuild-what-the-code-does-not-say) — a name that is not a domain word must be reconstructed by every reader.

**Mechanism:** A domain word carries its own type. When `c` can mean cell, column or
cellValue, every reader re-derives which one; named after the domain, the ambiguity cannot
exist.

**Rules out:**

- A single-letter identifier that is neither a domain term nor a library's documented name.
- The same short name meaning two different things in one file.
- A template binding named `i`, `ci`, `r` or `c`.

**Evidence:** Example: `for (const c of row.cells) total += c.v` against `for (const cell of row.cells) total += cell.value`.

**Verification:** Review: list every identifier of one or two letters in the change, and
check each against the exception.

**Status:** established

**Last refined:** 2026-11-11

### A rule is stated once and used by name

**Goal:** Every rule has one place to change, so a fix reaches every use at once.

**Invariant:** If code needs a condition, calculation or check, then it is defined once,
with a name, and every use refers to that name; the code that guards a rule and the code
that reads it use the same named definition.

**Scope:** Conditions, calculations, validations, permissions and constants that more than
one place relies on.

**Stands on:**

- [Copies of a rule drift apart](#copies-of-a-rule-drift-apart) — a second copy of a condition is the copy that drifts.

**Mechanism:** A named definition has one home, so it cannot disagree with itself. Before
adding a function, search for an existing one and reuse or extend it.

**Rules out:**

- The same condition written out in two places.
- A guard and a filter for the same rule that can disagree.

**Evidence:** Example: An `isOverdue` filter defined once and used by both the list query and the reminder job, instead of each writing `dueDate < now && !paid`.

**Verification:** Review: for each condition in the change, search for the same logic
elsewhere.

**Status:** established

**Last refined:** 2026-11-11

### Shared code serves one job

**Goal:** Every caller can rely on all of a shared piece of code, so changing it for one
caller never breaks another.

**Invariant:** If code is shared, then every caller uses its core behaviour; no caller
needs a mode flag that switches the core off, or a branch written for that caller alone.
An option that adjusts a side detail, such as a size or a label, is fine.

**Scope:** Shared functions, modules, components and services, and every decision to reuse
one.

**Stands on:**

- [Code shared by two jobs couples them](#code-shared-by-two-jobs-couples-them) — a flag
  or a caller branch is where two jobs meet inside one home.
- [One dependent cannot show what is shared](#one-dependent-cannot-show-what-is-shared) —
  the part two callers really share is smaller than the code they first reuse.

**Mechanism:** A caller that has to switch the core off shows that the home was chosen by
surface similarity, not by what the callers share. Split at the part both use, and each
caller adds its own behaviour on top.

**Rules out:**

- A flag that turns off the main behaviour, such as `disableMomentum` on a viewport whose
  point is momentum.
- `if (caller === …)` or an equivalent branch inside shared code.
- A caller that uses one part of a shared module and turns the rest off.

**Evidence:** Example: a viewport reused by a text input through `disableMomentum` and
`hideScrollbar`, replaced by a shared virtualized row list that both use unchanged.

**Verification:** Review: for each reuse in the change, list the flags and options it
passes, and check that none switches the core off.

**Status:** established

**Last refined:** 2026-11-11

### Sharing waits for the second dependent

**Goal:** Shared code exists only where it removes a real copy, so nothing is abstracted
for a need that may never come.

**Invariant:** If something moves into a shared home (a helper, an abstraction, the core of
an engine, a contract record), then at least two dependents need the same thing, and the
shared version names neither of them.

**Scope:** Extracting functions and abstractions, changing a shared core, promoting a local
invariant to a contract.

**Stands on:**

- [One dependent cannot show what is shared](#one-dependent-cannot-show-what-is-shared) — the second dependent is what shows the common part.

**Mechanism:** One dependent gives no evidence of what is shared; a guess at it becomes a
seam that later callers must bend around. The second dependent shows what is truly common.
A shared version that names one of its callers has been over-unified.

**Rules out:**

- An abstraction with a single caller, written for future use.
- A shared core that mentions one particular module, entity or caller by name.

**Evidence:** Example: Two reports need money formatted with the same rounding; `formatMoney` is extracted then, named after neither report.

**Verification:** Review: for each new shared function or abstraction, list its callers.

**Status:** established

**Last refined:** 2026-11-11

### A rule lives at the lowest layer that can say it

**Goal:** Each rule sits where the fewest things depend on it, so changing it disturbs as
little as possible.

**Invariant:** If a rule can be expressed at more than one layer, then it is expressed at
the least powerful layer that can express it, and moves up only when that layer cannot.

**Scope:** Systems with layers of different power, such as configuration, declarations, a
domain layer, a platform and a core.

**Stands on:**

- [A change to a layer reaches everything above it](#a-change-to-a-layer-reaches-everything-above-it) — a rule placed higher than needed reaches more than it needs to.

**Mechanism:** A higher layer has more dependents. A rule placed higher than needed couples
everything above it to a decision only one part needed.

**Rules out:**

- A business rule in an engine's core that a declaration or a setting could have stated.

**Evidence:** Example: The rule that hides archived projects is a filter on the project query, not code inside the database client that every query passes through.

**Verification:** Review: for each new rule, name the lowest layer that could state it.

**Status:** established

**Last refined:** 2026-11-11

### Escape hatches are named and checked

**Goal:** Every way around a guarantee is known and closed, so the guarantee holds.

**Invariant:** If code bypasses a guarantee (an untyped value, a non-null assertion, raw
SQL, a test-only helper), then the bypass lives in one named place, says why, and a test or
review closes it.

**Scope:** Type-system escapes, raw queries, privileged helpers, and any path around a rule's
home.

**Stands on:**

- [A guarantee covers only the paths through its check](#a-guarantee-covers-only-the-paths-through-its-check) — every hatch is a path the guarantee does not see.

**Mechanism:** A hatch is a way around a rule. Confined to one named place with a check, it
stays visible; scattered, it silently widens.

**Rules out:**

- Raw SQL outside the file the project reserves for it.
- An untyped value used as a default rather than at a boundary that needs it.

**Evidence:** Example: Raw SQL allowed in one module only, each use with a comment saying why the query builder cannot express it, and a test comparing its result with the builder's.

**Verification:** Review: list each hatch in the change, with its reason and its check.

**Status:** established

**Last refined:** 2026-11-11

### Derived data stays derived

**Goal:** What a screen or report shows keeps following its source, so nothing silently
drops what the data used to provide.

**Invariant:** If a list, option set or column set is derived from configuration, a
template or an API response, then its replacement is derived from the same source, never a
literal typed out by hand.

**Scope:** Rewrites and redesigns of anything data-driven.

**Stands on:**

- [Copies of a rule drift apart](#copies-of-a-rule-drift-apart) — a typed-out literal is a copy of its source.

**Mechanism:** A literal copies the source's values at one moment; when the source changes,
the literal does not.

**Rules out:**

- A redesigned screen whose options were typed out by hand where the old one read them
  from the data.

**Evidence:** Example: A redesigned filter menu that reads its options from the same configuration the old menu read, instead of a list typed into the component.

**Verification:** Review: for each list or option set, name where it comes from.

**Status:** established

**Last refined:** 2026-11-11

### Stored data stays readable

**Goal:** Data saved yesterday still works today, so no change loses what users stored.

**Invariant:** If a change touches the shape or meaning of stored data (database rows, saved
selections, anything round-tripped), then every value already stored keeps working.

**Scope:** Persisted formats, identifiers and saved user state.

**Stands on:**

- [Stored data outlives the code that wrote it](#stored-data-outlives-the-code-that-wrote-it) — every change meets data written by an older version.

**Mechanism:** Stored values outlive the code that wrote them. A fallback that discards what
it cannot parse is data loss, and the next save overwrites the original.

**Rules out:**

- A saved value that stops loading after a change, with no migration.

**Evidence:** Example: A new format for saved views ships with a reader for the old format, and a test that loads a view saved by the previous release.

**Verification:** Review: for each changed shape, say what happens to rows saved in the old
one.

**Status:** established

**Last refined:** 2026-11-11

### Contract changes are deliberate and declared

**Goal:** Anyone reading a change knows every behaviour it changes, so nothing important
changes by accident.

**Invariant:** If a change alters an API, a permission, a data structure or a stored format,
then it does so on purpose and says so; and the description names every behaviour the
change alters, intended or not.

**Scope:** Every change, especially one presented as presentational or as cleanup.

**Stands on:**

- [A reviewer checks only what they know changed](#a-reviewer-checks-only-what-they-know-changed) — only a declared change gets reviewed.

**Mechanism:** Changes made as a side effect go unreviewed, because nobody knew to look.

**Rules out:**

- A change described as a restyle that alters an endpoint, a permission or a stored shape.

**Evidence:** Example: A change description that says "renames `due_date` to `due_at` in the API response" beside the list of visual changes.

**Verification:** Review: compare the description with the diff.

**Status:** established

**Last refined:** 2026-11-11

### What the interface shows it does

**Goal:** Users can trust every control they see.

**Invariant:** If the interface shows a control, then using it does what it shows; a piece
that cannot be fully wired yet does not render as though it works.

**Scope:** Every user-facing control.

**Stands on:**

- [Users act on what the interface shows](#users-act-on-what-the-interface-shows) — a control that looks live will be used.

**Mechanism:** A control that looks live but drives nothing fails the user silently.

**Rules out:**

- A button or field that looks active and does nothing.

**Evidence:** Example: A button for a feature that is not built yet is left out, or shown disabled with a note, instead of rendering as live.

**Verification:** Review: for each new control, say what happens when a user uses it.

**Status:** established

**Last refined:** 2026-11-11

### Errors are typed and their failure modes named

**Goal:** A failure says what went wrong, so callers can handle it and readers can find it.

**Invariant:** If code throws, then it throws a specific error type, never a bare generic
error; and a call that can fail on bad input is wrapped, with a fallback and a comment that
names the failure mode.

**Scope:** All error paths.

**Stands on:**

- [A generic error carries only its message](#a-generic-error-carries-only-its-message) — only a typed error can be handled by kind.

**Mechanism:** A generic error carries only text. A typed one can be caught by kind, and a
named failure mode tells the next reader why the wrapper exists.

**Rules out:**

- `throw new Error('…')` in application code.

**Evidence:** Example: `throw new PaymentDeclinedError(orderId)` instead of `throw new Error('payment declined')`, so callers catch `PaymentDeclinedError` by type.

**Verification:** `grep -rn "new Error(" src/`, excluding the declarations of error types.

**Status:** established

**Last refined:** 2026-11-11

### Comments describe the code as it stands

**Goal:** A comment helps someone reading the code cold, long after the session that wrote
it.

**Invariant:** If code carries a comment, then it states what the code does and why,
readable without any other context, and it changes with the code it describes.

**Components:**

- **Self-contained:** never "as discussed", "per the ticket", "we decided", or "unlike the
  ones above".
- **Current:** a change updates the comments of the code it changes, and leaves unrelated
  comments alone.
- **Needed:** a doc comment only where the name and types do not already say what a function
  does, returns or affects.

**Scope:** All comments, doc comments included.

**Stands on:**

- [Readers rebuild what the code does not say](#readers-rebuild-what-the-code-does-not-say) — a comment that leans on missing context forces that reconstruction.

**Mechanism:** The reader of a comment has the code, not the conversation. A comment that
leans on the conversation, or describes old code, misleads.

**Rules out:**

- A comment that refers to the conversation or task that produced it.
- A comment that contradicts the code beside it.

**Evidence:** Example: "Retries three times: the provider drops the first connection after each deploy." Not: "Fixed as discussed in the ticket."

**Verification:** Review: read each changed comment without the conversation.

**Status:** established

**Last refined:** 2026-11-11

### Code exists for a present need

**Goal:** Every line has a reason today, so the code stays as small as the problem.

**Invariant:** If code is added, then a present requirement needs it: no feature, option,
flexibility or error handling for a scenario nobody asked for or that cannot happen.

**Scope:** All new code.

**Stands on:**

- [Every line costs its readers and maintainers](#every-line-costs-its-readers-and-maintainers) — a speculative line pays that cost for nothing.

**Mechanism:** Speculative code must be read, tested and kept working, and it guesses at
needs that later arrive in a different shape.

**Rules out:**

- A configuration option that nothing sets.
- Error handling for a case the types make impossible.

**Evidence:** Example: No `retryStrategy` option until a second caller needs a different strategy; one fixed retry until then.

**Verification:** Review: for each addition, name the requirement it serves.

**Status:** established

**Last refined:** 2026-11-11

### Every changed line traces to the task

**Goal:** A change shows exactly what it does, so reviewing it is reading it.

**Invariant:** If a change is made, then every changed line serves the task; it cleans up
only what the change itself made unused, and leaves unrelated code, comments and formatting
alone.

**Scope:** Every change to existing code.

**Stands on:**

- [A reviewer checks only what they know changed](#a-reviewer-checks-only-what-they-know-changed) — an unrelated edit hides inside the real change.
- [Every line costs its readers and maintainers](#every-line-costs-its-readers-and-maintainers) — every changed line must be read in review.

**Mechanism:** Unrelated edits hide the real change and spread its risk to code nobody meant
to touch.

**Rules out:**

- A change that reformats or refactors code unrelated to its task.

**Evidence:** Example: A bug fix that changes four lines in one function and leaves the rest of the file's formatting alone.

**Verification:** Review: for each changed hunk, name the part of the task it serves.

**Status:** established

**Last refined:** 2026-11-11
