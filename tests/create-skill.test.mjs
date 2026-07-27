import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSkill, parseArguments } from '../scripts/create-skill.mjs';
import { validateEvaluationFiles } from '../scripts/validate-evaluations.mjs';
import { validate } from '../scripts/validate-skills.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const DESCRIPTION = 'Drafts repeatable release notes from supplied changes. Use when a release needs a concise change summary.';

function makeRoot(prefix) {
  const root = makeTempDir(prefix);
  mkdirSync(resolve(root, 'skills'), { recursive: true });
  return root;
}

function readTree(root) {
  const files = {};
  const walk = (dir, relative = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(resolve(dir, entry.name), next);
      else if (entry.isSymbolicLink()) files[next] = '<symlink>';
      else files[next] = readFileSync(resolve(dir, entry.name), 'utf8');
    }
  };
  walk(root);
  return files;
}

test('creates an exact minimal portable skill and valid evaluation fixtures', () => {
  const root = makeRoot('create-skill-minimal-');
  try {
    createSkill({ root, name: 'release-notes', description: DESCRIPTION });

    assert.deepEqual(Object.keys(readTree(root)), [
      'evals/skills/release-notes/evals.json',
      'evals/skills/release-notes/routing.json',
      'skills/release-notes/SKILL.md',
    ]);
    assert.equal(readFileSync(resolve(root, 'skills/release-notes/SKILL.md'), 'utf8'), `---
name: release-notes
description: "Drafts repeatable release notes from supplied changes. Use when a release needs a concise change summary."
license: MIT
metadata:
  version: "1.0.0"
  tier: experimental
---

# Release Notes

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

Describe the final artifact and how completion is reported.
`);
    assert.deepEqual(
      JSON.parse(readFileSync(resolve(root, 'evals/skills/release-notes/evals.json'), 'utf8')),
      {
        schemaVersion: 1,
        name: 'release-notes-behavior',
        skill: 'release-notes',
        cases: [{
          id: 'primary-workflow',
          prompt: '[BEHAVIOR PROMPT: provide realistic inputs for release-notes]',
          assertions: [{
            id: 'expected-output',
            type: 'contains',
            value: '[EXPECTED OUTPUT: replace with an objective observable]',
          }],
          humanReview: [{
            id: 'output-quality',
            question: 'Does the candidate produce the intended artifact without unsupported claims?',
          }],
        }],
      },
    );
    assert.deepEqual(
      JSON.parse(readFileSync(resolve(root, 'evals/skills/release-notes/routing.json'), 'utf8')),
      {
        schemaVersion: 1,
        name: 'release-notes-routing',
        trials: 3,
        cases: [
          {
            id: 'training-positive',
            split: 'training',
            prompt: '[POSITIVE TRAINING PROMPT: describe when release-notes should activate]',
            expected: ['release-notes'],
            excluded: [],
          },
          {
            id: 'training-negative',
            split: 'training',
            prompt: '[NEGATIVE TRAINING PROMPT: describe creating or maintaining an Agent Skill scaffold]',
            expected: ['skill-creator'],
            excluded: ['release-notes'],
          },
          {
            id: 'validation-positive',
            split: 'validation',
            prompt: '[POSITIVE VALIDATION PROMPT: add a distinct realistic request for release-notes]',
            expected: ['release-notes'],
            excluded: [],
          },
          {
            id: 'validation-negative',
            split: 'validation',
            prompt: 'Create a new Agent Skill scaffold with portable frontmatter, routing fixtures, and behavior evaluations.',
            expected: ['skill-creator'],
            excluded: ['release-notes'],
          },
        ],
      },
    );
    for (const path of ['evals.json', 'routing.json']) {
      assert.ok(readFileSync(resolve(root, 'evals/skills/release-notes', path), 'utf8').endsWith('\n'));
    }
    assert.deepEqual(validate({ skillsRoot: resolve(root, 'skills') }).errors, []);
    assert.deepEqual(validate({ skillsRoot: resolve(root, 'skills'), profile: 'portable' }).errors, []);
    assert.deepEqual(validateEvaluationFiles({ root }), {
      errors: [],
      files: [
        'skills/release-notes/evals.json',
        'skills/release-notes/routing.json',
      ],
      behaviorCases: 1,
      routingCases: 4,
    });
  } finally {
    removeDir(root);
  }
});

test('creates only requested resource directories with non-evidence placeholders and author metadata', () => {
  const root = makeRoot('create-skill-resources-');
  try {
    createSkill({
      root,
      name: 'release-notes',
      description: DESCRIPTION,
      author: 'Example Maintainer',
      references: true,
      scripts: true,
      assets: true,
    });

    const tree = readTree(root);
    assert.deepEqual(Object.keys(tree), [
      'evals/skills/release-notes/evals.json',
      'evals/skills/release-notes/routing.json',
      'skills/release-notes/assets/README.md',
      'skills/release-notes/references/README.md',
      'skills/release-notes/scripts/README.md',
      'skills/release-notes/SKILL.md',
    ]);
    assert.match(tree['skills/release-notes/SKILL.md'], /  author: "Example Maintainer"\n  tier: experimental/);
    assert.match(tree['skills/release-notes/SKILL.md'], /\[References placeholder\]\(references\/README\.md\)/);
    for (const resource of ['assets', 'references', 'scripts']) {
      assert.equal(tree[`skills/release-notes/${resource}/README.md`], `# ${resource[0].toUpperCase()}${resource.slice(1)} Placeholder

This placeholder reserves the optional \`${resource}/\` directory. Replace it with necessary resources or remove the directory.

This file is not contribution, promotion, provenance, or evaluation evidence.
`);
    }
  } finally {
    removeDir(root);
  }
});

test('is deterministic across independent roots', () => {
  const first = makeRoot('create-skill-deterministic-a-');
  const second = makeRoot('create-skill-deterministic-b-');
  try {
    const options = {
      name: 'release-notes',
      description: DESCRIPTION,
      references: true,
      scripts: true,
      assets: true,
    };
    createSkill({ root: first, ...options });
    createSkill({ root: second, ...options });
    assert.deepEqual(readTree(first), readTree(second));
  } finally {
    removeDir(first);
    removeDir(second);
  }
});

test('parses help and rejects malformed arguments', () => {
  assert.deepEqual(parseArguments(['--help']), { help: true });
  for (const args of [
    ['--name', 'one', '--name', 'two', '--description', DESCRIPTION],
    ['--name', 'one', '--description'],
    ['--name', 'one', '--description', DESCRIPTION, '--unknown'],
    ['--name', 'one', '--description', DESCRIPTION, '--scripts', '--scripts'],
  ]) {
    assert.throws(() => parseArguments(args), /duplicate|missing value|unknown argument/i);
  }
});

test('CLI help is non-interactive and errors do not write output', () => {
  const root = makeRoot('create-skill-cli-');
  try {
    const help = spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/create-skill.mjs'), '--help'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /^Usage: npm run skill:create -- --name <slug>/);

    const failed = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'scripts/create-skill.mjs'),
      '--name', '../escape',
      '--description', DESCRIPTION,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /name/i);
    assert.deepEqual(readdirSync(resolve(root, 'skills')), []);
    assert.equal(existsSync(resolve(root, 'evals')), false);
  } finally {
    removeDir(root);
  }
});

test('rejects invalid names and descriptions before writing', () => {
  for (const name of ['../escape', '/absolute', 'Uppercase', 'two--hyphens', 'claude-helper', 'con', 'skill.md']) {
    const root = makeRoot('create-skill-invalid-name-');
    try {
      assert.throws(() => createSkill({ root, name, description: DESCRIPTION }), /name/i);
      assert.deepEqual(readdirSync(resolve(root, 'skills')), []);
      assert.equal(existsSync(resolve(root, 'evals')), false);
    } finally {
      removeDir(root);
    }
  }

  for (const description of [
    'Too short. Use when needed.',
    'I create release notes from changes. Use when a release needs notes.',
    'My workflow creates release notes from changes. Use when a release needs notes.',
    'We create release notes from changes. Use when a release needs notes.',
    'Creates release notes from your changes. Use when you need release notes.',
    'I’ll create release notes from changes. Use when a release needs notes.',
    "Drafts release notes from changes I've reviewed. Use when a release needs notes.",
    'Drafts release notes from changes I’ve reviewed. Use when a release needs notes.',
    "Drafts release notes I'd approve. Use when a release needs notes.",
    'Drafts release notes I’d approve. Use when a release needs notes.',
    'We’ll create release notes from changes. Use when a release needs notes.',
    'You’ll receive release notes from changes. Use when a release needs notes.',
    'Creates release notes from changes without an activation clause.',
    'Creates <notes> from changes. Use when a release needs notes.',
  ]) {
    const root = makeRoot('create-skill-invalid-description-');
    try {
      assert.throws(() => createSkill({ root, name: 'release-notes', description }), /description/i);
      assert.deepEqual(readdirSync(resolve(root, 'skills')), []);
    } finally {
      removeDir(root);
    }
  }
});

test('accepts a valid Phase I third-person description', () => {
  const root = makeRoot('create-skill-phase-one-');
  try {
    createSkill({
      root,
      name: 'clinical-protocols',
      description: 'Reviews Phase I clinical trial protocols. Use when assessing early-stage study plans.',
    });
    assert.equal(existsSync(resolve(root, 'skills/clinical-protocols/SKILL.md')), true);
  } finally {
    removeDir(root);
  }
});

test('refuses exact skill, eval, and file conflicts without partial writes', () => {
  const cases = [
    (root) => mkdirSync(resolve(root, 'skills/release-notes'), { recursive: true }),
    (root) => {
      mkdirSync(resolve(root, 'evals/skills/release-notes'), { recursive: true });
      writeFileSync(resolve(root, 'evals/skills/release-notes/conflict'), 'occupied\n');
    },
    (root) => {
      mkdirSync(resolve(root, 'evals'), { recursive: true });
      writeFileSync(resolve(root, 'evals/skills'), 'occupied\n');
    },
  ];

  for (const arrange of cases) {
    const root = makeRoot('create-skill-conflict-');
    try {
      arrange(root);
      const before = readTree(root);
      assert.throws(() => createSkill({ root, name: 'release-notes', description: DESCRIPTION }), /exists|symlink|conflict/i);
      assert.deepEqual(readTree(root), before);
    } finally {
      removeDir(root);
    }
  }
});

test('rejects symlinks in every existing component leading to output roots', () => {
  const cases = [
    {
      label: 'supplied root',
      arrange(base) {
        const target = resolve(base, 'target');
        mkdirSync(resolve(target, 'skills'), { recursive: true });
        const root = resolve(base, 'root-link');
        symlinkSync(target, root);
        return root;
      },
    },
    {
      label: 'ancestor of supplied root',
      arrange(base) {
        const target = resolve(base, 'target-parent');
        mkdirSync(resolve(target, 'repo', 'skills'), { recursive: true });
        const link = resolve(base, 'parent-link');
        symlinkSync(target, link);
        return resolve(link, 'repo');
      },
    },
    {
      label: 'skills',
      arrange(base) {
        const root = resolve(base, 'repo');
        const target = resolve(base, 'skills-target');
        mkdirSync(root);
        mkdirSync(target);
        symlinkSync(target, resolve(root, 'skills'));
        return root;
      },
    },
    {
      label: 'evals',
      arrange(base) {
        const root = makeNestedRoot(base);
        const target = resolve(base, 'evals-target');
        mkdirSync(target);
        symlinkSync(target, resolve(root, 'evals'));
        return root;
      },
    },
    {
      label: 'evals/skills',
      arrange(base) {
        const root = makeNestedRoot(base);
        const target = resolve(base, 'eval-skills-target');
        mkdirSync(resolve(root, 'evals'));
        mkdirSync(target);
        symlinkSync(target, resolve(root, 'evals/skills'));
        return root;
      },
    },
  ];

  function makeNestedRoot(base) {
    const root = resolve(base, 'repo');
    mkdirSync(resolve(root, 'skills'), { recursive: true });
    return root;
  }

  for (const { label, arrange } of cases) {
    const base = makeTempDir(`create-skill-symlink-${label.replaceAll('/', '-')}-`);
    try {
      const root = arrange(base);
      assert.throws(
        () => createSkill({ root, name: 'release-notes', description: DESCRIPTION }),
        /symlink/i,
        label,
      );
      assert.equal(existsSync(resolve(base, 'target', 'skills/release-notes')), false);
    } finally {
      removeDir(base);
    }
  }
});

test('uses deterministic code-point ordering for advisory skills', () => {
  const root = makeRoot('create-skill-order-');
  try {
    for (const name of ['release-ä', 'release-z', 'release-a']) {
      mkdirSync(resolve(root, 'skills', name));
    }
    const result = createSkill({ root, name: 'release-notes', description: DESCRIPTION });
    assert.deepEqual(result.adjacent, ['release-a', 'release-z', 'release-ä']);
  } finally {
    removeDir(root);
  }
});

test('evaluation discovery reports exact files and malformed per-skill suites', () => {
  const root = makeRoot('create-skill-eval-discovery-');
  try {
    createSkill({ root, name: 'release-notes', description: DESCRIPTION });
    const malformed = resolve(root, 'evals/skills/broken/evals.json');
    mkdirSync(dirname(malformed), { recursive: true });
    writeFileSync(malformed, '{ invalid json\n');

    const result = validateEvaluationFiles({ root });
    assert.deepEqual(result.files, [
      'skills/broken/evals.json',
      'skills/release-notes/evals.json',
      'skills/release-notes/routing.json',
    ]);
    assert.equal(result.behaviorCases, 1);
    assert.equal(result.routingCases, 4);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^skills\/broken\/evals\.json: /);
  } finally {
    removeDir(root);
  }
});

test('unexpected write failure rolls back only paths created by the invocation', () => {
  const root = makeRoot('create-skill-rollback-');
  try {
    writeFileSync(resolve(root, 'keep.txt'), 'keep\n');
    assert.throws(() => createSkill({
      root,
      name: 'release-notes',
      description: DESCRIPTION,
      simulateWriteFailureAfter: 1,
    }), /simulated write failure/i);
    assert.equal(readFileSync(resolve(root, 'keep.txt'), 'utf8'), 'keep\n');
    assert.deepEqual(readdirSync(resolve(root, 'skills')), []);
    assert.equal(existsSync(resolve(root, 'evals')), false);
  } finally {
    removeDir(root);
  }
});

test('success output labels overlap review as advisory and names required follow-ups', () => {
  const root = makeRoot('create-skill-output-');
  try {
    mkdirSync(resolve(root, 'skills/release-management'), { recursive: true });
    writeFileSync(resolve(root, 'skills/release-management/SKILL.md'), '# existing\n');
    const result = createSkill({ root, name: 'release-notes', description: DESCRIPTION });
    assert.match(result.message, /Advisory adjacent-skill review:/);
    assert.match(result.message, /release-management/);
    assert.match(result.message, /truthful discovery and lifecycle records/);
    assert.match(result.message, /contribution evidence/);
    assert.match(result.message, /README and CHANGELOG/);
    assert.match(result.message, /registry generation/);
    assert.match(result.message, /hosted evaluation/);
  } finally {
    removeDir(root);
  }
});
