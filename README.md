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

Other agents receive the framework manual (`IBR.md`) in their native instruction format:

```bash
npx @ibr-foundation/ibr install --cursor     # .cursor/rules/ibr.mdc
npx @ibr-foundation/ibr install --copilot    # .github/instructions/ibr.instructions.md
npx @ibr-foundation/ibr install --agents     # managed section in AGENTS.md
                                             # (Codex CLI, Windsurf, Gemini CLI, ...)
npx @ibr-foundation/ibr install --all        # Claude + every vendor whose footprint
                                             # exists here — creates nothing new
```

Installs are idempotent and refuse to clobber files you have customized
(`--force` overrides). The AGENTS.md target manages only its own marked section —
everything else in the file stays yours.

## Run the invariants checker

The checker is a single-file Node script (>=18, no dependencies):

```bash
npx @ibr-foundation/ibr check --all      # validate every *.invariants.md in the checkout
npx @ibr-foundation/ibr check --refs     # check code annotations + contract links
```

## The method, deeper

IBR works by elimination: strip the assumptions, conventions, frames, and inherited
categories that are not load-bearing, and keep collapsing the solution space until what
remains is the structure the domain itself enforces — the invariant. Then prove the
result by running it the other way: a true invariant does not just survive reduction,
it **generates** the domain back — every valid instance derivable from it, every
impossibility predicted by it.

That closed loop — **reduce until irreducible, then generate to confirm** — is what
separates IBR from philosophy (which argues but does not converge), from opinion (which
asserts without elimination), and from pattern matching (which recognizes without
reducing). IBR is first-principles reasoning made structural, auditable, falsifiable,
and generative.

**Reality has invariants.** In any domain, some structure remains stable across
transformations. What survives change is real structure; everything else is expression.
The invariant is always smaller than the problem space — so the correct direction of
thought is reduction, not accumulation.

**Candidates must be broken, not admired.** A proposed invariant is not accepted until
you actively try to destroy it: counterexamples, deletion of parts that look essential,
transfer into structurally equivalent domains, reconstruction of the strongest rival
explanation. What collapses was noise. What survives — and survives *attacks*, not
just agreement — is structural.

**A true invariant generates.** It is both the endpoint of reduction and the starting
point of production: it produces all valid instances of its domain, and — just as
important — it predicts what **cannot** exist if it holds. An idea with no impossibility
boundary predicts nothing and is a description, not a generator.

**Every invariant is an if–then, and the "if" has a scope.** Some conditions are set by
reality (physics), some by agreement (chess, law, code), some by what the parties are
(fairness, trust). Identifying which scope you are in is part of the method — chess rules
are not laws of nature, and physics is not up for a vote.

**All of it is provisional — structurally, not apologetically.** No concept is identical
to the reality it models. Every invariant is held only until a deeper one replaces it.
This is not a hedge; it is the accurate description of what concepts are — which is why
the method stays open to refinement without collapsing into relativism.

**Simplicity is the signature.** A true invariant increases power while decreasing
rules. If accepting an idea multiplies your branches, exceptions, and special cases,
it is not the invariant yet — keep reducing.

The full framework — the axioms, the operator set (elimination, validation, reframing,
sequencing), the two-axis reasoning audit, and the operational manual for AI — is in
[`IBR.md`](./IBR.md). It ships in this package, so the copy you install always matches
the version you run. It is also the file to load into an agent's system prompt:
`--append-system-prompt-file node_modules/@ibr-foundation/ibr/IBR.md`.

## Provenance

IBR was refined through collaborative human–AI reduction, applying its own principles
to itself — the framework you are reading survived its own method. Its history of
breaking rounds (multi-model red-team verification of the checker, rotated-model
reduction of the axioms) lives in this repository's commit log, which is the public
changelog: releases follow semver, and the framework and skills version together.

## License

MIT © Evgeny Kalashnikov. See [LICENSE](./LICENSE).
