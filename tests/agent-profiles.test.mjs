import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './helpers.mjs';

function profile(name) {
  return readFileSync(resolve(REPO_ROOT, `.github/agents/${name}.agent.md`), 'utf8');
}

test('learning agent has no edit or execution authority', () => {
  const content = profile('skill-learning');
  assert.match(content, /^tools: \[read, search, web\]$/m);
  assert.match(content, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(content, /^tools:.*\b(edit|execute)\b/m);
  assert.match(content, /may not edit files, execute code, create or update issues/);
  assert.match(content, /Duplicate check/);
});

test('improvement agent requires one approved and leased item', () => {
  const content = profile('skill-improvement');
  assert.match(content, /^tools: \[read, search, edit, execute\]$/m);
  assert.match(content, /^disable-model-invocation: true$/m);
  assert.match(content, /One improvement item in `ready` or `in-progress` state/);
  assert.match(content, /valid, unexpired lease owned by this run/);
  assert.match(content, /Never approve or merge the result/);
});

test('implementation agent delegates bounded exploration and review', () => {
  const content = profile('implementation');
  assert.match(content, /^tools: \[read, search, edit, execute, agent, web, todo\]$/m);
  assert.match(content, /^  - Implementation Explorer$/m);
  assert.match(content, /^  - Implementation Reviewer$/m);
  assert.match(content, /fast built-in `explore` agent/);
  assert.match(content, /high-signal built-in `code-review` agent/);
  assert.match(content, /Make the smallest complete change/);
  assert.match(content, /Run the narrowest relevant validation/);
  assert.match(
    content,
    /Give the reviewer the request, acceptance criteria, relevant diff, and\s+validation evidence/,
  );
});

test('implementation specialists are hidden and read-only', () => {
  for (const name of ['implementation-explorer', 'implementation-reviewer']) {
    const content = profile(name);
    assert.match(content, /^user-invocable: false$/m);
    assert.match(content, /^tools: \[read, search\]$/m);
    assert.doesNotMatch(content, /^tools:.*\b(edit|execute)\b/m);
  }

  assert.match(profile('implementation-explorer'), /Do not modify files/);
  assert.match(profile('implementation-reviewer'), /Do not modify files/);
});