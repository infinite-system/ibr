# <Module> review profile

How to review <module> with `/ibr-code-review`. This file says how to review, never what
was found: no findings, scores or conclusions belong here, because the reviewer reads it.

## Scope

Write each path in backticks, relative to the repository root: the new-code script reads
these two lines.

- Contracts: `<path/to/module.invariants.md>`
- Code: `<path/to/module/>`, `<another/folder/>`

## Substrate

What the results depend on. The reviewer reads each version and records it in
`ibr-code-review-substrate.json`, so a score change can be told apart from a version
change.

- <component>: <the command or file that gives its version>

## How to run

- Tests: <commands>
- The app or service: <how to start it, and where it serves>
- Data: <the seed or fixture data to review against, and how to reset it>
- Accounts: <the users or personas to act as, and where their credentials are documented>

## Coverage dimensions

The axes behaviour varies along, and which combinations to exercise (every combination,
or a named subset and why).

- <dimension>: <its values>

## How to observe

How to build independent answers for Observed: the source of each expected answer (the
specification or the declaration, never the system's own output), and how to compare.

## Tracked measures

Numbers recorded each round in `ibr-code-review-measures.json`, shown beside the score
and never folded into it.

- <measure>: <what it counts, and how>

## Walkthrough

The screens, flows or endpoints to exercise by hand, and as which users.

## Presentation

Optional: how this module presents a round's result, such as a script that builds a
review page from the round folder.
