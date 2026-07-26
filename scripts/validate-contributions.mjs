#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateContributionEvidence } from './lib/contribution-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argumentsFor(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function changedSkillsFromGit(base) {
  const execution = spawnSync('git', [
    'diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`, '--', 'skills',
  ], { cwd: ROOT, encoding: 'utf8' });
  if (execution.error) throw execution.error;
  if (execution.status !== 0) throw new Error(`git diff failed: ${execution.stderr.trim()}`);
  return execution.stdout.split('\n').flatMap((path) => {
    const match = path.match(/^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\//);
    return match ? [match[1]] : [];
  });
}

function main() {
  const evidenceRoot = resolve(argument('evidence-root') ?? resolve(ROOT, 'evals', 'contributions'));
  const artifactRoot = resolve(argument('artifact-root') ?? ROOT);
  const changedSkills = new Set(argumentsFor('changed-skill'));
  const base = argument('base');
  if (base) {
    for (const skill of changedSkillsFromGit(base)) changedSkills.add(skill);
  }
  if (changedSkills.size === 0) {
    console.log('No changed skills require contribution evidence.');
    return;
  }

  const schema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/contribution-evidence.schema.json'), 'utf8'));
  const resultSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
  const suiteSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/eval-suite.schema.json'), 'utf8'));
  const errors = [];
  for (const skill of [...changedSkills].sort()) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) {
      errors.push(`Invalid changed skill name: ${skill}.`);
      continue;
    }
    const manifestPath = resolve(evidenceRoot, `${skill}.json`);
    if (!existsSync(manifestPath)) {
      errors.push(`Missing contribution evidence for changed skill ${skill}: ${manifestPath}.`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      errors.push(`Invalid contribution evidence JSON for ${skill}: ${error.message}`);
      continue;
    }
    if (manifest.skill !== skill) errors.push(`${manifestPath}: manifest skill must equal ${skill}.`);
    for (const error of validateContributionEvidence(schema, manifest, { artifactRoot, resultSchema, suiteSchema })) {
      errors.push(`${manifestPath}: ${error}`);
    }
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Contribution evidence is valid for ${changedSkills.size} changed skill(s).`);
}

try {
  main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}