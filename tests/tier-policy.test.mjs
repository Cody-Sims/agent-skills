import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as tierPolicy from '../scripts/lib/tier-policy.mjs';

function maturity(status, evidence = []) {
  return {
    status,
    lastEvaluatedAt: status === 'unverified' ? null : '2026-07-26',
    evidence: evidence.map((type) => ({
      type,
      reference: `evidence/${type}.json`,
      sha256: '0'.repeat(64),
      recordedAt: '2026-07-26',
    })),
  };
}

const promotionEvidence = [
  'structural-validation',
  'behavior-evaluation',
  'routing-evaluation',
  'runtime-smoke-test',
  'maintainer-approval',
];

test('tier promotions advance one tier and require complete verified evidence', () => {
  const previous = { name: 'alpha', tier: 'experimental', maturity: maturity('verified', [
    'structural-validation',
    'maintainer-approval',
  ]) };
  const unsupported = {
    name: 'alpha',
    tier: 'core',
    maturity: maturity('verified', promotionEvidence),
  };
  assert.match(
    (tierPolicy.validateTierTransition?.(previous, unsupported) ?? []).join('\n'),
    /must advance one tier at a time/,
  );

  const incomplete = {
    name: 'alpha',
    tier: 'extended',
    maturity: maturity('unverified'),
  };
  assert.match(
    (tierPolicy.validateTierTransition?.(previous, incomplete) ?? []).join('\n'),
    /promotion to extended requires verified maturity/,
  );

  const complete = {
    name: 'alpha',
    tier: 'extended',
    maturity: maturity('verified', promotionEvidence),
  };
  assert.deepEqual(tierPolicy.validateTierTransition?.(previous, complete), []);
});

test('new skills enter as experimental and demotions require regression evidence', () => {
  const newCore = {
    name: 'alpha',
    tier: 'core',
    maturity: maturity('verified', promotionEvidence),
  };
  assert.match(
    (tierPolicy.validateTierTransition?.(null, newCore) ?? []).join('\n'),
    /new skills must enter as experimental/,
  );

  const previous = newCore;
  const unsupportedDemotion = {
    name: 'alpha',
    tier: 'extended',
    maturity: maturity('unverified'),
  };
  assert.match(
    (tierPolicy.validateTierTransition?.(previous, unsupportedDemotion) ?? []).join('\n'),
    /demotion to extended requires regressed maturity/,
  );

  const supportedDemotion = {
    name: 'alpha',
    tier: 'extended',
    maturity: maturity('regressed', ['regression-report', 'maintainer-approval']),
  };
  assert.deepEqual(tierPolicy.validateTierTransition?.(previous, supportedDemotion), []);

  supportedDemotion.maturity.lastEvaluatedAt = null;
  assert.match(
    tierPolicy.validateTierTransition(previous, supportedDemotion).join('\n'),
    /regressed maturity requires an evaluation date/,
  );
});

test('tier validation rejects inherited object property names', () => {
  const candidate = {
    name: 'alpha',
    tier: 'toString',
    maturity: maturity('unverified'),
  };
  assert.match(
    tierPolicy.validateTierTransition(null, candidate).join('\n'),
    /candidate tier is required/,
  );
});
