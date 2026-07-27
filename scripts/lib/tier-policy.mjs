const PROMOTION_EVIDENCE = Object.freeze({
  experimental: ['structural-validation', 'maintainer-approval'],
  extended: [
    'structural-validation',
    'behavior-evaluation',
    'routing-evaluation',
    'runtime-smoke-test',
    'maintainer-approval',
  ],
  core: [
    'structural-validation',
    'behavior-evaluation',
    'routing-evaluation',
    'runtime-smoke-test',
    'maintainer-approval',
  ],
});

const TIER_RANK = Object.freeze({
  experimental: 0,
  extended: 1,
  core: 2,
});

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateMaturity(tier, maturity, path = '$.maturity') {
  if (!maturity || typeof maturity !== 'object') return [];

  const errors = [];
  const evidenceTypes = new Set((maturity.evidence ?? []).map((entry) => entry.type));
  if (maturity.lastEvaluatedAt !== null && !isCalendarDate(maturity.lastEvaluatedAt)) {
    errors.push(`${path}.lastEvaluatedAt: value must be a valid calendar date.`);
  }
  for (const [index, evidence] of (maturity.evidence ?? []).entries()) {
    if (!isCalendarDate(evidence.recordedAt)) {
      errors.push(`${path}.evidence[${index}].recordedAt: value must be a valid calendar date.`);
    }
  }
  if (maturity.status === 'verified') {
    if (!maturity.lastEvaluatedAt) {
      errors.push(`${path}.lastEvaluatedAt: verified maturity requires an evaluation date.`);
    }
    const required = PROMOTION_EVIDENCE[tier] ?? [];
    const missing = required.filter((type) => !evidenceTypes.has(type));
    if (missing.length > 0) {
      errors.push(`${path}.evidence: ${tier ?? 'unset'} tier requires evidence: ${missing.join(', ')}.`);
    }
  }
  if (maturity.status === 'regressed') {
    if (!maturity.lastEvaluatedAt) {
      errors.push(`${path}.lastEvaluatedAt: regressed maturity requires an evaluation date.`);
    }
    const required = ['regression-report', 'maintainer-approval'];
    const missing = required.filter((type) => !evidenceTypes.has(type));
    if (missing.length > 0) {
      errors.push(`${path}.evidence: regressed maturity requires evidence: ${missing.join(', ')}.`);
    }
  }
  return errors;
}

export function validateTierTransition(previous, candidate) {
  const path = `$.skills.${candidate?.name ?? 'unknown'}`;
  const errors = [];
  if (!candidate || !Object.hasOwn(TIER_RANK, candidate.tier)) {
    return [`${path}.tier: candidate tier is required.`];
  }
  if (!previous) {
    if (candidate.tier !== 'experimental') {
      errors.push(`${path}.tier: new skills must enter as experimental.`);
    }
    if (candidate.maturity?.status !== 'verified') {
      errors.push(`${path}.maturity.status: new experimental entries require verified maturity.`);
    }
    errors.push(...validateMaturity(candidate.tier, candidate.maturity, `${path}.maturity`));
    return errors;
  }
  if (previous.name !== candidate.name) {
    errors.push(`${path}.name: previous and candidate skill names must match.`);
    return errors;
  }
  if (!Object.hasOwn(TIER_RANK, previous.tier)) {
    errors.push(`${path}.tier: previous tier is invalid.`);
    return errors;
  }

  const delta = TIER_RANK[candidate.tier] - TIER_RANK[previous.tier];
  if (delta > 0) {
    if (delta !== 1) {
      errors.push(`${path}.tier: promotions must advance one tier at a time.`);
    }
    if (candidate.maturity?.status !== 'verified') {
      errors.push(`${path}.maturity.status: promotion to ${candidate.tier} requires verified maturity.`);
    }
    errors.push(...validateMaturity(candidate.tier, candidate.maturity, `${path}.maturity`));
  } else if (delta < 0) {
    if (candidate.maturity?.status !== 'regressed') {
      errors.push(`${path}.maturity.status: demotion to ${candidate.tier} requires regressed maturity.`);
    }
    errors.push(...validateMaturity(candidate.tier, candidate.maturity, `${path}.maturity`));
  } else {
    errors.push(...validateMaturity(candidate.tier, candidate.maturity, `${path}.maturity`));
  }
  return errors;
}
