#!/usr/bin/env node
// CLI for the IBR package.
//
//   npx @ibr-foundation/ibr install [target] [vendor flags]   install the framework
//   npx @ibr-foundation/ibr check [args...]                   run the invariants checker
//   npx @ibr-foundation/ibr help                              usage
//
// Zero dependencies. The skills and framework doc ship alongside this file.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const binDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(binDirectory, '..');
const skillsRoot = join(packageRoot, 'skills');
const packageVersion = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
).version;

const [command, ...commandArguments] = process.argv.slice(2);

function usage() {
  console.log(`ibr — Invariant-Based Reasoning

  ibr install [target] [flags]
      Install IBR for coding agents into <target> (default: current directory).
      Claude is the native format — the full /ibr and /invariants skills,
      scripts and checker included. Other vendors receive the framework
      manual (IBR.md) in their native instruction format:
        (none) / --claude   .claude/skills/{ibr,invariants}/
        --cursor            .cursor/rules/ibr.mdc
        --copilot           .github/instructions/ibr.instructions.md
        --agents / --codex  a managed section in AGENTS.md (Codex CLI,
                            Windsurf and others read this file)
        --gemini            a managed section in GEMINI.md (Gemini CLI)
        --all               Claude + every vendor whose footprint exists
                            (.cursor/, .github/, AGENTS.md, GEMINI.md) —
                            creates nothing new
        --force             overwrite locally modified copies

  ibr check [args...]
      Run the invariants contract checker. Args pass through,
      e.g. 'ibr check --all' or 'ibr check --refs'.

  ibr help              Show this message.

Docs: IBR.md ships in this package and at https://github.com/infinite-system/ibr`);
}

function fail(message) {
  console.error(`ibr: ${message}`);
  process.exit(1);
}

function install(installArguments) {
  const flags = installArguments.filter((argument) => argument.startsWith('--'));
  const positional = installArguments.filter(
    (argument) => !argument.startsWith('--'),
  );
  const targetRoot = resolve(positional[0] || process.cwd());
  const force = flags.includes('--force');

  const frameworkPath = join(packageRoot, 'IBR.md');
  if (!existsSync(frameworkPath)) {
    fail(`IBR.md missing from package at ${frameworkPath}`);
  }
  const frameworkText = readFileSync(frameworkPath, 'utf8');

  // Write one single-file target idempotently; refuse to clobber local edits
  // without --force (ivue's installer discipline, ported).
  function installFile(relativePath, content, label) {
    const targetPath = join(targetRoot, relativePath);
    if (existsSync(targetPath)) {
      const existing = readFileSync(targetPath, 'utf8');
      if (existing === content) {
        console.log(`ibr: ${label} already up to date (ibr v${packageVersion}).`);
        return;
      }
      if (!force) {
        fail(
          `${relativePath} exists and differs from ibr v${packageVersion}'s copy.\n` +
            '     Re-run with --force to overwrite it.',
        );
      }
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content);
    console.log(`ibr: ${label} installed at ${relativePath} (ibr v${packageVersion}).`);
  }

  // Explicit flags always install (creating the folder is the point).
  // --all is detect-and-equip: vendor targets only where their footprint
  // already exists — it never scaffolds a tool you don't use. Claude is the
  // native format and installs in every mode.
  const wantAll = flags.includes('--all');
  const detected = (marker) => existsSync(join(targetRoot, marker));
  const skippedNotice = (label, marker, flag) =>
    console.log(`ibr: ${label} skipped — no ${marker} here (pass ${flag} to create it).`);

  const wantCursor = flags.includes('--cursor') || (wantAll && detected('.cursor'));
  const wantCopilot = flags.includes('--copilot') || (wantAll && detected('.github'));
  const wantAgents =
    flags.includes('--agents') ||
    flags.includes('--codex') || // Codex CLI reads AGENTS.md — same target
    (wantAll && detected('AGENTS.md'));
  const wantGemini = flags.includes('--gemini') || (wantAll && detected('GEMINI.md'));
  const wantClaude =
    wantAll ||
    flags.includes('--claude') ||
    (!wantCursor && !wantCopilot && !wantAgents && !wantGemini);

  if (wantClaude) {
    const destination = join(targetRoot, '.claude', 'skills');
    mkdirSync(destination, { recursive: true });
    for (const skillName of ['ibr', 'invariants']) {
      const sourceDirectory = join(skillsRoot, skillName);
      if (!existsSync(sourceDirectory)) {
        fail(`bundled skill '${skillName}' missing from package at ${sourceDirectory}`);
      }
      // Clobber guard on the skill's manifest: a locally modified SKILL.md
      // means the user customized the skill — keep theirs without --force.
      const installedManifest = join(destination, skillName, 'SKILL.md');
      if (existsSync(installedManifest) && !force) {
        const existing = readFileSync(installedManifest, 'utf8');
        const shipped = readFileSync(join(sourceDirectory, 'SKILL.md'), 'utf8');
        if (existing !== shipped) {
          console.log(
            `ibr: skill '${skillName}' at ${installedManifest} was customized — keeping yours.\n` +
              '     Re-run with --force to overwrite your customizations.',
          );
          continue;
        }
      }
      cpSync(sourceDirectory, join(destination, skillName), { recursive: true });
      console.log(`ibr: skill '${skillName}' installed -> ${join(destination, skillName)}`);
    }
  }

  if (wantAll && !wantCursor) skippedNotice('Cursor rule', '.cursor/', '--cursor');
  if (wantAll && !wantCopilot) skippedNotice('Copilot instructions', '.github/', '--copilot');
  if (wantAll && !wantAgents) skippedNotice('AGENTS.md section', 'AGENTS.md', '--agents');
  if (wantAll && !wantGemini) skippedNotice('GEMINI.md section', 'GEMINI.md', '--gemini');

  if (wantCursor) {
    installFile(
      join('.cursor', 'rules', 'ibr.mdc'),
      `---\ndescription: Invariant-Based Reasoning (IBR) — reduce problems to their invariant structure; the full framework and operating manual.\nglobs:\nalwaysApply: false\n---\n\n${frameworkText}`,
      'Cursor rule',
    );
  }

  if (wantCopilot) {
    installFile(
      join('.github', 'instructions', 'ibr.instructions.md'),
      `---\napplyTo: '**'\n---\n\n${frameworkText}`,
      'Copilot instructions',
    );
  }

  // Shared context files (AGENTS.md, GEMINI.md) are user-owned — manage only
  // a marked section; everything outside the markers stays theirs.
  function installManagedSection(fileName, flagName) {
    const startMarker = '<!-- ibr:framework:start -->';
    const endMarker = '<!-- ibr:framework:end -->';
    const section = `${startMarker}\n<!-- managed by \`npx @ibr-foundation/ibr install ${flagName}\` — edits inside are overwritten -->\n\n${frameworkText}\n${endMarker}`;
    const filePath = join(targetRoot, fileName);
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf8');
      const startIndex = existing.indexOf(startMarker);
      const endIndex = existing.indexOf(endMarker);
      if (startIndex !== -1 && endIndex !== -1) {
        const updated =
          existing.slice(0, startIndex) +
          section +
          existing.slice(endIndex + endMarker.length);
        if (updated === existing) {
          console.log(`ibr: ${fileName} section already up to date (ibr v${packageVersion}).`);
        } else {
          writeFileSync(filePath, updated);
          console.log(`ibr: ${fileName} section updated (ibr v${packageVersion}).`);
        }
      } else {
        writeFileSync(filePath, existing.trimEnd() + '\n\n' + section + '\n');
        console.log(`ibr: ${fileName} section appended (ibr v${packageVersion}).`);
      }
    } else {
      writeFileSync(filePath, section + '\n');
      console.log(`ibr: ${fileName} created (ibr v${packageVersion}).`);
    }
  }

  if (wantAgents) installManagedSection('AGENTS.md', '--agents');
  if (wantGemini) installManagedSection('GEMINI.md', '--gemini');
}

function check(checkArguments) {
  const checkerScript = join(skillsRoot, 'invariants', 'scripts', 'check_invariants.mjs');
  if (!existsSync(checkerScript)) {
    fail(`checker missing from package at ${checkerScript}`);
  }
  const result = spawnSync(process.execPath, [checkerScript, ...checkArguments], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

switch (command) {
  case 'install': install(commandArguments); break;
  case 'check': check(commandArguments); break;
  case undefined:
  case 'help':
  case '--help':
  case '-h': usage(); break;
  default:
    console.error(`unknown command: ${command}\n`);
    usage();
    process.exit(2);
}
