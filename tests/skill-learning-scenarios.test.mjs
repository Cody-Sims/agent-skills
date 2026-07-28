import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateImprovementProposal } from '../scripts/lib/improvement-proposal.mjs';
import { REPO_ROOT } from './helpers.mjs';

const schema = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'schemas/improvement-proposal.schema.json'), 'utf8'),
);

const source = {
  url: 'https://github.com/Cody-Sims/agent-skills/blob/823cf37/BACKLOG.md',
  publisher: 'Cody-Sims/agent-skills',
  retrievalDate: '2026-07-27',
  applicableVersion: '823cf37',
};

function groundedProposal() {
  return {
    schemaVersion: 1,
    title: 'Validate learning-agent proposals deterministically',
    problem: {
      statement: 'The learning-agent profile has no executable proposal-quality gate.',
      evidenceIds: ['V-1'],
    },
    evidence: {
      verified: [{
        id: 'V-1',
        claim: 'SI-002 requires behavioral scenarios for proposal refusal and acceptance.',
        sources: [source],
      }],
      inferred: [{
        id: 'I-1',
        claim: 'A dependency-free validator can make those scenario outcomes repeatable.',
        sources: [source],
      }],
      unknown: [{
        id: 'U-1',
        question: 'Whether live model output will satisfy the contract consistently.',
        resolution: 'Run a separately approved model evaluation after deterministic validation lands.',
      }],
    },
    expectedBenefit: {
      statement: 'Invalid proposals are refused before maintainer review.',
      measure: 'Scenario acceptance and refusal outcomes',
      baseline: 'No deterministic scenario gate',
      target: 'All five SI-002 scenarios return their specified outcomes',
    },
    scope: {
      summary: 'Add a proposal schema, validator, and deterministic scenarios.',
      allowedPaths: [
        'schemas/improvement-proposal.schema.json',
        'scripts/lib/improvement-proposal.mjs',
        'tests/skill-learning-scenarios.test.mjs',
      ],
      nonGoals: ['Creating issues or changing repository content from the learning agent'],
      protectedPathsRequiringApproval: [],
    },
    effort: 'S',
    risk: [{
      description: 'A structural validator may accept weak prose.',
      mitigation: 'Require explicit evidence links and independently checkable outcomes.',
    }],
    dependencies: ['SI-001', 'AS-005'],
    acceptanceCriteria: [{
      id: 'AC-1',
      outcome: 'Five deterministic proposal scenarios produce stable decisions.',
      verificationIds: ['VERIFY-1'],
    }],
    verification: [{
      id: 'VERIFY-1',
      method: 'command',
      procedure: 'node --test tests/skill-learning-scenarios.test.mjs',
      expectedResult: 'The process exits zero and all five scenarios pass.',
    }],
    deduplication: {
      identity: 'si-002-deterministic-proposal-validation',
      searches: [
        { surface: 'backlog', query: 'SI-002 proposal validation', matches: [] },
        { surface: 'issues', query: 'deterministic proposal validation', matches: [] },
        { surface: 'pull-requests', query: 'deterministic proposal validation', matches: [] },
        { surface: 'history', query: 'improvement-proposal', matches: [] },
      ],
    },
    authorityBoundary: {
      mode: 'proposal-only',
      requestedCapabilities: [],
    },
  };
}

const options = {
  existingIdentities: [],
  allowedPathPatterns: [
    '.github/agents/skill-learning.agent.md',
    '.github/ISSUE_TEMPLATE/skill-improvement.yml',
    'schemas/improvement-proposal.schema.json',
    'scripts/lib/improvement-proposal.mjs',
    'tests/skill-learning-scenarios.test.mjs',
  ],
};

test('refuses a proposal with a duplicate identity', () => {
  const proposal = groundedProposal();
  const result = validateImprovementProposal(schema, proposal, {
    ...options,
    existingIdentities: [proposal.deduplication.identity],
  });

  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'duplicate');
  assert.match(result.reasons[0], /deduplication identity/);
});

test('refuses an uncited proposal', () => {
  const proposal = groundedProposal();
  proposal.evidence.verified[0].sources = [];

  const result = validateImprovementProposal(schema, proposal, options);

  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'uncited');
  assert.match(result.reasons[0], /V-1/);
});

test('refuses an untestable proposal', () => {
  const proposal = groundedProposal();
  proposal.acceptanceCriteria[0].verificationIds = ['VERIFY-MISSING'];

  const result = validateImprovementProposal(schema, proposal, options);

  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'untestable');
  assert.match(result.reasons[0], /VERIFY-MISSING/);
});

test('refuses a proposal outside the learning-agent authority boundary', () => {
  const proposal = groundedProposal();
  proposal.authorityBoundary.requestedCapabilities = ['issue:create'];

  const result = validateImprovementProposal(schema, proposal, options);

  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'out-of-scope');
  assert.match(result.reasons[0], /proposal-only/);
});

test('accepts a grounded novel proposal', () => {
  assert.deepEqual(validateImprovementProposal(schema, groundedProposal(), options), {
    schemaVersion: 1,
    status: 'accepted',
    code: 'grounded-novel',
    reasons: [],
  });
});

test('strictly rejects unsupported contract versions and fields', () => {
  const proposal = groundedProposal();
  proposal.schemaVersion = 2;
  proposal.unreviewed = true;

  const result = validateImprovementProposal(schema, proposal, options);

  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'invalid-contract');
  assert.match(result.reasons.join('\n'), /schemaVersion/);
  assert.match(result.reasons.join('\n'), /unreviewed/);
});

test('profile and issue form preserve proposal-only authority and contract fields', () => {
  const profile = readFileSync(
    resolve(REPO_ROOT, '.github/agents/skill-learning.agent.md'),
    'utf8',
  );
  const issueForm = readFileSync(
    resolve(REPO_ROOT, '.github/ISSUE_TEMPLATE/skill-improvement.yml'),
    'utf8',
  );

  assert.match(profile, /^tools: \[read, search, web\]$/m);
  assert.match(profile, /schemas\/improvement-proposal\.schema\.json/);
  assert.match(profile, /proposal-only/);
  assert.match(profile, /may not .*create or update issues/i);
  assert.doesNotMatch(profile, /^tools:.*\b(edit|execute)\b/m);

  for (const label of [
    'Contract version',
    'Deduplication identity',
    'Verified facts',
    'Inferences',
    'Unknowns',
    'Verification',
  ]) {
    assert.match(issueForm, new RegExp(`label: ${label}`));
  }
});
