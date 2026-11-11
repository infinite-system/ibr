#!/usr/bin/env node
// Identify the code a stored review has not seen yet.
//
// Reads a review profile's Scope (its `Contracts:` and `Code:` lines, paths in backticks)
// and the commit of the previous round, then prints:
//   - the code in scope that was added, changed, renamed or deleted since that commit;
//   - code outside the scope that annotates one of the scope's contracts: code that
//     already belongs to the module, so the profile's Scope should grow to include it.
// It scores nothing. Single file, Node >= 18, no dependencies; needs git.

import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const HELP = `ibr-code-review-new-code.mjs — the code a stored review has not seen yet

usage:
  node ibr-code-review-new-code.mjs --profile <module.ibr-code-review.md> [--previous <round folder>] [--root <repository>]

--profile    the review profile; its Scope lines name the contracts and the code paths
--previous   the previous round's folder; its ibr-code-review-score.json holds the commit
             the last review saw. Without it, the whole scope is new (first round).
--root       the repository root (default: the current directory)

exit codes: 0 listed, 1 the input is missing or malformed`;

const backticked = (line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());

export function readScope(profileText) {
  const scopeStart = profileText.search(/^## Scope\s*$/m);
  if (scopeStart < 0) return { contracts: [], code: [] };
  const rest = profileText.slice(scopeStart);
  const nextHeading = rest.slice(1).search(/^## /m);
  const scope = nextHeading < 0 ? rest : rest.slice(0, nextHeading + 1);
  const line = (label) =>
    scope.split('\n').find((text) => new RegExp(`^\\s*-\\s*${label}:`).test(text)) ?? '';
  return { contracts: backticked(line('Contracts')), code: backticked(line('Code')) };
}

function git(root, gitArguments) {
  return execFileSync('git', gitArguments, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function changedInScope(root, since, codePaths) {
  const output = git(root, ['diff', '--name-status', '--find-renames', `${since}..HEAD`, '--', ...codePaths]);
  const words = { A: 'added', M: 'changed', D: 'deleted', R: 'renamed', C: 'copied', T: 'changed' };
  return output
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [status, ...paths] = row.split('\t');
      return { change: words[status[0]] ?? status, path: paths.join(' → ') };
    });
}

export function governedOutsideScope(root, contracts, codePaths, ownFolder = null) {
  const annotated = new Map(); // path -> contracts it annotates
  for (const contract of contracts) {
    let output = '';
    try {
      output = git(root, [
        'grep', '-l', '-F', `(${contract})`, '--', '.',
        ...codePaths.map((path) => `:!${path}`),
        ':!*.invariants.md',
        ':!*.ibr-code-review.md',
        // a profile folder's own scripts name its contracts; they are review code, not the module
        ...(ownFolder ? [`:!${ownFolder}`] : []),
      ]);
    } catch {
      continue; // git grep exits 1 when nothing matches
    }
    for (const path of output.split('\n').filter(Boolean)) {
      if (!annotated.has(path)) annotated.set(path, []);
      annotated.get(path).push(contract);
    }
  }
  return [...annotated].map(([path, annotatedContracts]) => ({ path, contracts: annotatedContracts }));
}

function main(argv) {
  if (argv.includes('--help') || argv.length === 0) {
    console.log(HELP);
    return 0;
  }
  let profilePath = null;
  let previousFolder = null;
  let root = process.cwd();
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--profile') profilePath = argv[++index];
    else if (argv[index] === '--previous') previousFolder = argv[++index];
    else if (argv[index] === '--root') root = resolve(argv[++index]);
    else {
      console.error(`unknown argument ${argv[index]} (--help for usage)`);
      return 1;
    }
  }
  if (!profilePath || !existsSync(profilePath)) {
    console.error(`profile not found: ${profilePath ?? '(none given)'}`);
    return 1;
  }
  const scope = readScope(readFileSync(profilePath, 'utf8'));
  if (scope.code.length === 0 || scope.contracts.length === 0) {
    console.error(
      "the profile's Scope needs a `- Contracts:` and a `- Code:` line, each with paths in backticks",
    );
    return 1;
  }

  if (previousFolder) {
    const scorePath = join(resolve(previousFolder), 'ibr-code-review-score.json');
    const since = existsSync(scorePath) ? JSON.parse(readFileSync(scorePath, 'utf8')).commit : null;
    if (!since) {
      console.error(`no commit recorded in ${scorePath}`);
      return 1;
    }
    const changes = changedInScope(root, since, scope.code);
    console.log(`## New or changed in scope since ${since}`);
    if (changes.length === 0) console.log('None.');
    for (const { change, path } of changes) console.log(`- ${change}: ${path}`);
  } else {
    console.log('## New or changed in scope');
    console.log(`First round: the whole scope is new (${scope.code.join(', ')}).`);
  }

  // a profile kept in a folder of its own name (<module>.ibr-code-review/) owns that folder
  const profileFolder = dirname(resolve(profilePath));
  const ownFolder = basename(profileFolder).endsWith('.ibr-code-review')
    ? relative(root, profileFolder)
    : null;
  const outside = governedOutsideScope(root, scope.contracts, scope.code, ownFolder);
  console.log('');
  console.log("## Code outside the profile's scope that annotates its contracts");
  if (outside.length === 0) console.log('None.');
  for (const { path, contracts } of outside) console.log(`- ${path} (annotates ${contracts.join(', ')})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exit(main(process.argv.slice(2)));
}
