# IBR — Invariant-Based Reasoning

A method for reducing a problem to the irreducible structures that actually exist in its
domain — by eliminating non-structural assumptions until the invariant geometry emerges,
then generating from it to confirm. This package ships the framework and two Claude skills
that put it to work.

- **`IBR.md`** — the full framework: the axioms (each marked discovered or chosen), the
  discovery, validation, and construction operators, the reduction/generation proof loop,
  an axiom dependency map, a worked example, and the operational manual. Load it straight
  into an agent's system prompt — the most direct way to run IBR:

  ```bash
  claude --append-system-prompt-file node_modules/@ibr-foundation/ibr/IBR.md
  ```
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
                                             # (Codex CLI, Windsurf, ...)
npx @ibr-foundation/ibr install --gemini     # managed section in GEMINI.md (Gemini CLI)
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

IBR does three jobs, and they meet at one point — the generator:

- **Discover** — strip the assumptions, conventions, frames, and inherited categories that
  are not load-bearing, and keep collapsing the solution space until what remains is the
  structure the domain itself enforces: the invariant.
- **Validate** — attack every finding before trusting it, then prove it by running it the
  other way: a true invariant does not just survive reduction, it **generates** the domain
  back — every valid instance derivable from it, every impossibility predicted by it.
- **Construct** — once you know what reality already fixes, choose what else to fix, and
  build outward from the generator.

Understanding contracts toward generators; engineering expands from them. That closed
loop — **reduce until irreducible, generate to confirm, build on what survives** — is what
separates IBR from philosophy (which argues but does not converge), from opinion (which
asserts without elimination), and from pattern matching (which recognizes without
reducing). IBR is first-principles reasoning made structural, auditable, falsifiable,
generative, and constructive.

**Reality has invariants — observed, not assumed.** In any domain, some structure remains
stable across transformations; coherent observation already contains it, and any attempt
to refute it must use the invariants it denies. The invariant is always smaller than the
problem space it generates — so the direction of conclusion is reduction, not
accumulation.

**Variation obscures the invariant — and expansion feeds reduction.** Variation divides
into expression — the generator showing itself in many forms — and noise, which carries no
signal. Invariance is only visible *across* variation. So widen the field — new cases,
other domains, attempted breaks — before trusting what survives. A reduction over a
narrow field compresses to a false floor, however clean it looks.

**Candidates must be broken, not admired.** A proposed invariant is not accepted until
you actively try to destroy it: counterexamples, deletion of parts that look essential,
transfer into structurally equivalent domains, reconstruction of the strongest rival
explanation. What collapses was never structural. What survives — and survives *attacks*,
not just agreement — is.

**A true invariant generates.** It is both the endpoint of reduction and the starting
point of production: it produces all valid instances of its domain, and — just as
important — it predicts what **cannot** exist if it holds. An idea with no impossibility
boundary predicts nothing and is a description, not a generator.

**IBR builds as well as finds.** Engineering through IBR starts by discovering what the
substrate already constrains, maps which freedoms actually remain, then deliberately fixes
the ones whose constraint generates the intended structure — placed where they have the
greatest downstream reach, so consequences propagate instead of being enforced one by
one. The choice of constraint is free; what follows from it is not.

**Every invariant is an if–then, and the "if" has a scope.** Some conditions are set by
reality (physics), some by agreement (chess, law, code), some by what the parties are
(fairness, trust). Identifying which scope you are in is part of the method — chess rules
are not laws of nature, and physics is not up for a vote.

**The axioms say what they are.** IBR applies its own construction to itself: each axiom
is marked **discovered** (reality enforces it on any reasoner), **chosen** (a standard the
method places on the wielder so it cuts), or a discovered relation carrying a chosen
standard. So you can tell what reality enforces from what the method chooses — and every
choice has to keep earning its place.

**All of it is provisional — structurally, not apologetically.** No concept is identical
to the reality it models. Every invariant is held only until a deeper one replaces it.
This is not a hedge; it is the accurate description of what concepts are — which is why
the method stays open to refinement without collapsing into relativism.

**Simplicity is the signature.** A true invariant increases power while decreasing
rules. If accepting an idea multiplies your branches, exceptions, and special cases,
it is not the invariant yet — keep reducing.

The full framework is in [`IBR.md`](./IBR.md). It ships in this package, so the copy you
install always matches the version you run. **Where to start reading:** the *Worked
Example* first — one real reduction, traced end to end — then the *Axiom Dependency Map*
for the architecture (one ground, three spines), then the axioms and operators
themselves.

## Provenance

IBR was refined through collaborative human–AI reduction, applying its own principles
to itself — the framework you are reading survived its own method. Its history of
breaking rounds (multi-model red-team verification of the checker, rotated-model
reduction of the axioms) lives in this repository's commit log, which is the public
changelog: releases follow semver, and the framework and skills version together.

## License

MIT © Evgeny Kalashnikov. See [LICENSE](./LICENSE).
