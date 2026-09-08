# IBR — Invariant-Based Reasoning

A method for reducing a problem to the irreducible structures that actually exist in its
domain — by eliminating non-structural assumptions until the invariant geometry emerges,
then generating from it to confirm. This package ships the framework and two Claude skills
that put it to work.

- **`IBR.md`** — the full framework: axioms, operators, the reduction/generation proof
  loop, the Scope axiom, and the operational manual.
- **`/ibr` skill** — loads IBR as a session's reasoning engine and applies it operationally.
- **`/invariants` skill** — persists and enforces a codebase's load-bearing invariants as
  contract files (`*.invariants.md`), with a zero-dependency checker, scope derivation,
  scoring, and audit modes.

## Install the skills into a project

```bash
npx @ibr-foundation/ibr install          # into ./.claude/skills
npx @ibr-foundation/ibr install path/to/project
```

Then invoke `/ibr` or `/invariants` in Claude Code, or read `IBR.md` directly.

## Run the invariants checker

The checker is a single-file Node script (>=18, no dependencies):

```bash
npx @ibr-foundation/ibr check --all      # validate every *.invariants.md in the checkout
npx @ibr-foundation/ibr check --refs     # check code annotations + lattice links
```

## Versioning

This repository's commit and tag history is the public changelog for IBR. Releases follow
semver on the package; the framework and skills are versioned together.

## License

MIT © Evgeny Kalashnikov. See [LICENSE](./LICENSE).
