---
name: ibr-code-standards
description: >-
  The IBR coding standards, written as invariant records with a Goal each: names unfold to
  the domain, a rule is stated once, sharing waits for the second dependent, a rule lives
  at the lowest layer that can say it, escape hatches are named and checked, derived and
  stored data stay intact, contract changes are declared, comments describe the code as it
  stands, and every changed line traces to the task. Use when writing or reviewing code,
  naming things, deciding whether to extract shared code, setting up a project's coding
  standards, or when the user says "/ibr-code-standards" or "check the coding standards".
---

# /ibr-code-standards

The standards live in `ibr-code-standards.invariants.md`, in the same contract format as
any project contract (see `/ibr-code-invariants`). Each standard is a chosen record with a
**Goal** (what it is for), an **Invariant**, a **Rules out** list that makes a
violation observable, and a **Stands on** naming the reality records it responds to, such
as "Copies of a rule drift apart" or "Readers rebuild what the code does not say".

| Standard | In one line |
| --- | --- |
| Every rule has one home | One home per rule, every path through it, serving that rule only |
| Names unfold to the domain | No single letters or abbreviations, in code, tests and templates |
| A rule is stated once and used by name | Define a condition once; guard and read share it |
| Shared code serves one job | No flag that switches the core off, no branch for one caller |
| Sharing waits for the second dependent | No abstraction until two dependents need the same thing |
| A rule lives at the lowest layer that can say it | Move a rule up a layer only when the lower one cannot say it |
| Escape hatches are named and checked | Every bypass in one named place, with its reason and its check |
| Derived data stays derived | Never replace a derivation with a typed-out literal |
| Stored data stays readable | Values already stored keep working |
| Contract changes are deliberate and declared | No API, permission or format change as a side effect |
| What the interface shows it does | No control that looks live and does nothing |
| Errors are typed and their failure modes named | No bare generic errors |
| Comments describe the code as it stands | Self-contained, current, only where needed |
| Code exists for a present need | Nothing speculative |
| Every changed line traces to the task | No unrelated edits |

## Using the standards

- **Writing code:** follow the records. Where a record's `Rules out` describes
  what you are about to write, stop. Before writing any rule (a condition, a calculation,
  a check), decide its home:
  1. **Search for an existing home.** If it serves your need unchanged, use it.
  2. **If using it would need a flag that switches its core off, or a branch for your
     caller,** do not reuse it. Find the part you and its other callers really share,
     make that the home, and build each caller's own behaviour on top.
  3. **If there is no home yet,** write the rule where it is needed. Extract it when a
     second dependent needs the same thing, cut at what the two have in common.
  4. **Route every path through the home.** A path that cannot is an escape hatch: name
     it and give it a check.
- **Reviewing code:** each record's `Verification` is the review question. A violation is a
  finding, with the record's name.
- **Adopting them in a project:** copy the records the project adopts into its own contract
  (for example `project.invariants.md`), under the same names, so annotations and reviews
  line up. The checker resolves links only within one repository, so a project cannot link
  to this file; the copy is deliberate. `/ibr-code-review` then scores them like any other
  record.

Project-specific conventions, such as file naming, framework idioms or a project's own
engine rules, stay in the project. Add a standard here only when it holds for any codebase.
