import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './helpers.mjs';

function workflow(name) {
  return readFileSync(resolve(REPO_ROOT, `.github/workflows/${name}.yml`), 'utf8');
}

test('all repository workflow actions use immutable commit pins', () => {
  for (const name of ['copilot-setup-steps', 'improvement-control', 'improvement-policy', 'validate']) {
    const content = workflow(name);
    for (const line of content.split('\n').filter((candidate) => candidate.trim().startsWith('uses:'))) {
      assert.match(line, /uses: [^@]+@[0-9a-f]{40}(?:\s+#\s+v\d+)?$/);
    }
  }
});

test('pull request validation checks tier transitions against the base registry', () => {
  const content = workflow('validate');
  assert.match(content, /github\.event\.pull_request\.base\.sha/);
  assert.match(content, /git show "\$\{BASE_SHA\}:registry\/skills\.json"/);
  assert.match(content, /--previous "\$RUNNER_TEMP\/previous-registry\.json"/);
});

test('maturity evidence requires maintainer review', () => {
  const content = readFileSync(resolve(REPO_ROOT, '.github/CODEOWNERS'), 'utf8');
  assert.match(content, /^\/registry\/maturity\.json @Cody-Sims$/m);
});

test('queue transitions require trusted inputs, maintainer authority, and bot audit provenance', () => {
  const content = workflow('improvement-control');
  assert.match(content, /const operation = process\.env\.IMPROVEMENT_OPERATION/);
  assert.match(content, /if \(!isMaintainer\)/);
  assert.match(content, /comment\.user\?\.login !== 'github-actions\[bot\]'/);
  assert.match(content, /state: 'all', labels: 'improvement:in-progress'/);
  assert.match(content, /policy\.maxConcurrentRuns/);
  assert.match(content, /policy\.leaseMinutes/);
  assert.match(content, /agent-login is required for claim/);
  assert.match(content, /dispatch expire before claiming new work/);
  assert.match(content, /operationId: `\$\{context\.runId\}:\$\{context\.runAttempt\}`/);
});

test('pull request policy executes from the base commit and freezes a validated head', () => {
  const content = workflow('improvement-policy');
  assert.match(content, /github\.event\.pull_request\.user\.login == 'copilot-swe-agent\[bot\]'/);
  assert.match(content, /A maintainer must add the continuous-improvement label/);
  assert.match(content, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(content, /issues: write/);
  assert.match(content, /checks: read/);
  assert.match(content, /comment\.user\?\.login !== 'github-actions\[bot\]'/);
  assert.match(content, /event\.operation === 'draft-ready'/);
  assert.match(content, /event\.headSha === pull\.head\.sha/);
  assert.match(content, /event\.prBodySha256 === prBodySha256/);
  assert.match(content, /PR author does not match the approved claim/);
  assert.match(content, /Run duration budget exceeded/);
  assert.match(content, /github\.rest\.checks\.listForRef/);
  assert.match(content, /ref: pull\.head\.sha/);
  assert.match(content, /candidate\.status === 'completed'/);
  assert.match(content, /candidate\.conclusion === 'success'/);
  assert.match(content, /setTimeout\(resolve, 15_000\)/);
  assert.match(content, /Required checks have not succeeded for this head/);
  assert.doesNotMatch(content, /validationEvidence\.includes/);
  assert.match(content, /leaseExpired && !acceptedHead/);
  assert.match(content, /Only a draft-ready implementation may pass policy/);
});

test('merge completion revalidates item, approval, lease, and accepted head', () => {
  const content = workflow('improvement-control');
  assert.match(content, /digest !== approval/);
  assert.match(content, /claim\.leaseId !== leaseId/);
  assert.match(content, /candidate\.headSha === context\.payload\.pull_request\.head\.sha/);
  assert.match(content, /candidate\.prBodySha256 === prBodySha256/);
  assert.match(content, /github\.event\.pull_request\.base\.ref == github\.event\.repository\.default_branch/);
  assert.match(content, /Merged PR head has no policy-validated draft-ready event/);
  assert.match(content, /closed without a completion event/);
  assert.match(content, /state_reason: 'completed'/);
});