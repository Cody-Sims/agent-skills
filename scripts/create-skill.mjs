#!/usr/bin/env node

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseFrontmatter } from './lib/frontmatter.mjs';
import { usesFirstOrSecondPerson } from './lib/description-language.mjs';
import { validateAgainstSchema } from './lib/jsonschema.mjs';
import {
  assertNoSymlinkComponents,
  assertNoSymlinks,
  pathEntryExists,
  resolveInside,
} from './lib/paths.mjs';
import { validateEvaluationSuite } from './lib/evaluations.mjs';
import { validateRoutingSuite } from './lib/routing-evaluations.mjs';
import { validate } from './validate-skills.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const VALUE_OPTIONS = new Set(['--name', '--description', '--author']);
const FLAG_OPTIONS = new Set(['--references', '--scripts', '--assets', '--help']);
const RESOURCE_NAMES = ['references', 'scripts', 'assets'];

export const HELP = `Usage: npm run skill:create -- --name <slug> --description <text> [--author <name>] [--references] [--scripts] [--assets]

Creates a portable skill scaffold plus behavior and routing evaluation suites.
The command is non-interactive and never overwrites or merges existing paths.
`;

function quoteYaml(value) {
  return JSON.stringify(value);
}

function titleFromName(name) {
  return name.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
}

function makeSkillContent({
  name,
  description,
  author,
  references,
}) {
  const authorLine = author === undefined ? '' : `  author: ${quoteYaml(author)}\n`;
  const referencesSection = references
    ? '\n\n## References\n\n1. [References placeholder](references/README.md)\n'
    : '\n';
  return `---
name: ${name}
description: ${quoteYaml(description)}
license: MIT
metadata:
  version: "1.0.0"
${authorLine}  tier: experimental
---

# ${titleFromName(name)}

## Goal

State the outcome this skill must produce.

## Inputs

1. List the required user inputs and accepted formats.

## Workflow

1. Confirm the request is in scope.
2. Inspect the supplied inputs.
3. Produce the requested artifact.
4. Check the result against the stated constraints.

## Validation

1. Replace this placeholder with objective checks for the generated output.

## Output

Describe the final artifact and how completion is reported.${referencesSection}`;
}

function makeEvaluationSuite(name) {
  return {
    schemaVersion: 1,
    name: `${name}-behavior`,
    skill: name,
    cases: [
      {
        id: 'primary-workflow',
        prompt: `[BEHAVIOR PROMPT: provide realistic inputs for ${name}]`,
        assertions: [
          {
            id: 'expected-output',
            type: 'contains',
            value: '[EXPECTED OUTPUT: replace with an objective observable]',
          },
        ],
        humanReview: [
          {
            id: 'output-quality',
            question: 'Does the candidate produce the intended artifact without unsupported claims?',
          },
        ],
      },
    ],
  };
}

function makeRoutingSuite(name) {
  return {
    schemaVersion: 1,
    name: `${name}-routing`,
    trials: 3,
    cases: [
      {
        id: 'training-positive',
        split: 'training',
        prompt: `[POSITIVE TRAINING PROMPT: describe when ${name} should activate]`,
        expected: [name],
        excluded: [],
      },
      {
        id: 'training-negative',
        split: 'training',
        prompt: '[NEGATIVE TRAINING PROMPT: describe creating or maintaining an Agent Skill scaffold]',
        expected: ['skill-creator'],
        excluded: [name],
      },
      {
        id: 'validation-positive',
        split: 'validation',
        prompt: `[POSITIVE VALIDATION PROMPT: add a distinct realistic request for ${name}]`,
        expected: [name],
        excluded: [],
      },
      {
        id: 'validation-negative',
        split: 'validation',
        prompt: 'Create a new Agent Skill scaffold with portable frontmatter, routing fixtures, and behavior evaluations.',
        expected: ['skill-creator'],
        excluded: [name],
      },
    ],
  };
}

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resourcePlaceholder(resource) {
  return `# ${titleFromName(resource)} Placeholder

This placeholder reserves the optional \`${resource}/\` directory. Replace it with necessary resources or remove the directory.

This file is not contribution, promotion, provenance, or evaluation evidence.
`;
}

function validateName(name) {
  if (typeof name !== 'string' || isAbsolute(name) || name.length > 64
      || !NAME_PATTERN.test(name) || /anthropic|claude/i.test(name)
      || RESERVED_NAME_PATTERN.test(name) || name === basename('SKILL.md').toLowerCase()) {
    throw new Error('Invalid --name: use 1-64 lowercase ASCII letters, digits, and single hyphens; reserved and path-like names are not allowed.');
  }
}

function validateDescription(description) {
  if (typeof description !== 'string' || description.length < 40 || description.length > 1024
      || description.trim() !== description || /[\r\n\u0000-\u001f\u007f]/.test(description)
      || description.includes('<') || description.includes('>')
      || !/\bUse when\b/.test(description) || usesFirstOrSecondPerson(description)
      || !/^[A-Z][A-Za-z]/.test(description)) {
    throw new Error('Invalid --description: use 40-1024 characters, third person, no control or angle-bracket characters, and an explicit "Use when..." clause.');
  }
}

function validateAuthor(author) {
  if (author === undefined) return;
  if (typeof author !== 'string' || author.trim() !== author || author.length < 1 || author.length > 200
      || /[\r\n\u0000-\u001f\u007f]/.test(author) || author.includes('<') || author.includes('>')) {
    throw new Error('Invalid --author: use a non-empty single-line string of at most 200 characters.');
  }
}

export function parseArguments(args) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!VALUE_OPTIONS.has(argument) && !FLAG_OPTIONS.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
    seen.add(argument);
    if (argument === '--help') {
      if (args.length !== 1) throw new Error('--help cannot be combined with other arguments.');
      return { help: true };
    }
    if (VALUE_OPTIONS.has(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      options[argument.slice(2)] = true;
    }
  }
  if (!seen.has('--name')) throw new Error('Missing required argument: --name.');
  if (!seen.has('--description')) throw new Error('Missing required argument: --description.');
  return options;
}

function makePlan(options) {
  const files = new Map([
    ['skills/SKILL.md', makeSkillContent(options)],
    ['evals/evals.json', jsonFile(makeEvaluationSuite(options.name))],
    ['evals/routing.json', jsonFile(makeRoutingSuite(options.name))],
  ]);
  for (const resource of RESOURCE_NAMES) {
    if (options[resource]) files.set(`skills/${resource}/README.md`, resourcePlaceholder(resource));
  }
  return files;
}

function schema(name) {
  return JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'schemas', name), 'utf8'));
}

function validatePlan(options, plan) {
  const parsed = parseFrontmatter(plan.get('skills/SKILL.md'));
  const frontmatterErrors = validateAgainstSchema(schema('skill.schema.json'), parsed.data);
  const evaluationErrors = validateEvaluationSuite(
    schema('eval-suite.schema.json'),
    JSON.parse(plan.get('evals/evals.json')),
  );
  const routingErrors = validateRoutingSuite(
    schema('routing-suite.schema.json'),
    JSON.parse(plan.get('evals/routing.json')),
  );
  const errors = [...frontmatterErrors, ...evaluationErrors, ...routingErrors];
  if (errors.length > 0) throw new Error(`Generated scaffold failed schema validation:\n${errors.join('\n')}`);

  const stagingRoot = mkdtempSync(resolve(tmpdir(), 'agent-skills-create-'));
  try {
    const skillDir = resolve(stagingRoot, 'skills', options.name);
    mkdirSync(skillDir, { recursive: true });
    for (const [plannedPath, content] of plan) {
      if (!plannedPath.startsWith('skills/')) continue;
      const destination = resolve(skillDir, plannedPath.slice('skills/'.length));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content, { encoding: 'utf8', flag: 'wx' });
    }
    for (const profile of ['repository', 'portable']) {
      const diagnostics = validate({ skillsRoot: resolve(stagingRoot, 'skills'), profile });
      if (diagnostics.hasErrors()) {
        throw new Error(`Generated scaffold failed ${profile} validation:\n${diagnostics.errors.map((entry) => entry.message).join('\n')}`);
      }
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function ensureDirectory(path, created) {
  if (pathEntryExists(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a symlink in an output path: ${path}`);
    if (!stat.isDirectory()) throw new Error(`Output path conflict: ${path} exists and is not a directory.`);
    return;
  }
  mkdirSync(path);
  created.push({ path, kind: 'parent' });
}

function preflight(root, name, plan) {
  const resolvedRoot = assertNoSymlinkComponents(root);
  if (!pathEntryExists(resolvedRoot) || !lstatSync(resolvedRoot).isDirectory()) {
    throw new Error(`Repository root does not exist or is not a directory: ${resolvedRoot}`);
  }
  assertNoSymlinks(resolvedRoot, '.');
  const skillsRoot = assertNoSymlinks(resolvedRoot, 'skills');
  if (!pathEntryExists(skillsRoot) || !lstatSync(skillsRoot).isDirectory()) {
    throw new Error(`Expected an existing skills directory: ${skillsRoot}`);
  }
  const skillDestination = assertNoSymlinks(skillsRoot, name);
  const evalDestination = assertNoSymlinks(resolvedRoot, `evals/skills/${name}`);
  for (const destination of [skillDestination, evalDestination]) {
    if (pathEntryExists(destination)) throw new Error(`Output path already exists; refusing to overwrite or merge: ${destination}`);
  }
  for (const plannedPath of plan.keys()) {
    const destination = plannedPath.startsWith('skills/')
      ? resolveInside(skillDestination, plannedPath.slice('skills/'.length))
      : resolveInside(evalDestination, plannedPath.slice('evals/'.length));
    if (pathEntryExists(destination)) throw new Error(`Output path conflict: ${destination}`);
  }
  return { resolvedRoot, skillDestination, evalDestination };
}

function rollback(created) {
  for (const entry of [...created].reverse()) {
    try {
      if (entry.kind === 'tree') rmSync(entry.path, { recursive: true, force: true });
      else rmdirSync(entry.path);
    } catch {
      // Preserve pre-existing paths and continue best-effort cleanup.
    }
  }
}

function writePlan(destinations, plan, simulateWriteFailureAfter) {
  const created = [];
  let writes = 0;
  try {
    const evalsRoot = resolve(destinations.resolvedRoot, 'evals');
    const evalSkillsRoot = resolve(evalsRoot, 'skills');
    ensureDirectory(evalsRoot, created);
    ensureDirectory(evalSkillsRoot, created);
    mkdirSync(destinations.skillDestination);
    created.push({ path: destinations.skillDestination, kind: 'tree' });
    mkdirSync(destinations.evalDestination);
    created.push({ path: destinations.evalDestination, kind: 'tree' });

    for (const [plannedPath, content] of plan) {
      const destination = plannedPath.startsWith('skills/')
        ? resolveInside(destinations.skillDestination, plannedPath.slice('skills/'.length))
        : resolveInside(destinations.evalDestination, plannedPath.slice('evals/'.length));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content, { encoding: 'utf8', flag: 'wx' });
      writes += 1;
      if (writes === simulateWriteFailureAfter) throw new Error('Simulated write failure.');
    }
  } catch (error) {
    rollback(created);
    throw error;
  }
}

function catalogNames(skillsRoot) {
  if (!pathEntryExists(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
}

function adjacentSkills(name, names) {
  const tokens = new Set(name.split('-'));
  const shared = names.filter((candidate) => candidate.split('-').some((token) => tokens.has(token)));
  if (shared.length > 0) return shared;
  return names
    .map((candidate) => ({ candidate, distance: editDistance(name, candidate) }))
    .sort((a, b) => a.distance - b.distance
      || (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0))
    .slice(0, 5)
    .map(({ candidate }) => candidate);
}

function successMessage(root, name, adjacent) {
  const relativeRoot = (path) => relative(root, path).split(sep).join('/');
  const advisory = adjacent.length > 0 ? adjacent.join(', ') : '(catalog has no other skills)';
  return [
    `Created ${relativeRoot(resolve(root, 'skills', name, 'SKILL.md'))}.`,
    `Created ${relativeRoot(resolve(root, 'evals', 'skills', name, 'evals.json'))}.`,
    `Created ${relativeRoot(resolve(root, 'evals', 'skills', name, 'routing.json'))}.`,
    `Advisory adjacent-skill review: ${advisory}. This lexical/name heuristic is not a semantic overlap decision.`,
    'Required follow-ups:',
    '- Add truthful discovery and lifecycle records.',
    '- Add real contribution evidence; do not treat generated placeholders as evidence.',
    '- Update README and CHANGELOG.',
    '- Run registry generation and check the generated registry.',
    '- Run hosted evaluation and record only observed evidence.',
  ].join('\n');
}

export function createSkill({
  root = process.cwd(),
  name,
  description,
  author,
  references = false,
  scripts = false,
  assets = false,
  simulateWriteFailureAfter,
} = {}) {
  validateName(name);
  validateDescription(description);
  validateAuthor(author);
  const options = { name, description, author, references, scripts, assets };
  const plan = makePlan(options);
  const destinations = preflight(root, name, plan);
  validatePlan(options, plan);
  const adjacent = adjacentSkills(name, catalogNames(resolve(destinations.resolvedRoot, 'skills')));
  writePlan(destinations, plan, simulateWriteFailureAfter);
  return {
    files: [...plan.keys()],
    adjacent,
    message: successMessage(destinations.resolvedRoot, name, adjacent),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const result = createSkill(options);
  process.stdout.write(`${result.message}\n`);
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
