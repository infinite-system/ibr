#!/usr/bin/env node
// CLI for the IBR package.
//
//   npx @invariantai/ibr install [target]   copy the /ibr + /invariants skills
//                                             into <target>/.claude/skills (default: cwd)
//   npx @invariantai/ibr check [args...]     run the invariants contract checker
//   npx @invariantai/ibr help                usage
//
// Zero dependencies. The skills and framework doc ship alongside this file.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const SKILLS = join(PKG, 'skills');

const [cmd, ...rest] = process.argv.slice(2);

function usage() {
  console.log(`ibr — Invariant-Based Reasoning

  ibr install [target]   Install the /ibr and /invariants skills into
                         <target>/.claude/skills (default: current directory).
  ibr check [args...]    Run the invariants contract checker. Args pass through,
                         e.g. 'ibr check --all' or 'ibr check --refs'.
  ibr help               Show this message.

Docs: IBR.md ships in this package and at https://github.com/infinite-system/ibr`);
}

function install(target) {
  const dest = join(resolve(target || process.cwd()), '.claude', 'skills');
  mkdirSync(dest, { recursive: true });
  for (const skill of ['ibr', 'invariants']) {
    const from = join(SKILLS, skill);
    if (!existsSync(from)) {
      console.error(`error: bundled skill '${skill}' missing from package at ${from}`);
      process.exit(1);
    }
    cpSync(from, join(dest, skill), { recursive: true });
    console.log(`installed ${skill} -> ${join(dest, skill)}`);
  }
  console.log('\nDone. The /ibr and /invariants skills are now available in this project.');
}

function check(args) {
  const script = join(SKILLS, 'invariants', 'scripts', 'check_invariants.mjs');
  if (!existsSync(script)) {
    console.error(`error: checker missing from package at ${script}`);
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

switch (cmd) {
  case 'install': install(rest[0]); break;
  case 'check': check(rest); break;
  case undefined:
  case 'help':
  case '--help':
  case '-h': usage(); break;
  default:
    console.error(`unknown command: ${cmd}\n`);
    usage();
    process.exit(2);
}
