import { validateAgainstSchema } from './jsonschema.mjs';

export const IMPROVEMENT_PROPOSAL_SCHEMA_VERSION = 1;

const REQUIRED_DEDUPLICATION_SURFACES = [
  'backlog',
  'issues',
  'pull-requests',
  'history',
];

function decision(status, code, reasons = []) {
  return {
    schemaVersion: IMPROVEMENT_PROPOSAL_SCHEMA_VERSION,
    status,
    code,
    reasons,
  };
}

function pathMatches(path, pattern) {
  let regex = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      regex += '.*';
      index += 1;
    } else if (character === '*') {
      regex += '[^/]*';
    } else {
      regex += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${regex}$`).test(path);
}

function citationErrors(proposal) {
  const errors = [];
  const claims = [
    ...(proposal?.evidence?.verified ?? []),
    ...(proposal?.evidence?.inferred ?? []),
  ];
  for (const claim of claims) {
    if (!Array.isArray(claim?.sources) || claim.sources.length === 0) {
      errors.push(`Evidence ${claim?.id ?? '<missing id>'} has no source citation.`);
      continue;
    }
    for (const [index, source] of claim.sources.entries()) {
      const complete = source
        && typeof source.url === 'string'
        && /^https:\/\/\S+$/.test(source.url)
        && typeof source.publisher === 'string'
        && source.publisher.length > 0
        && typeof source.retrievalDate === 'string'
        && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(source.retrievalDate)
        && typeof source.applicableVersion === 'string'
        && source.applicableVersion.length > 0;
      if (!complete) {
        errors.push(`Evidence ${claim?.id ?? '<missing id>'} source ${index + 1} is incomplete.`);
      }
    }
  }
  return errors;
}

function testabilityErrors(proposal) {
  const criteria = proposal?.acceptanceCriteria;
  const verification = proposal?.verification;
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return ['At least one acceptance criterion is required.'];
  }
  if (!Array.isArray(verification) || verification.length === 0) {
    return ['At least one verification procedure is required.'];
  }

  const verificationIds = new Set(verification.map((item) => item?.id));
  const errors = [];
  for (const criterion of criteria) {
    if (!Array.isArray(criterion?.verificationIds) || criterion.verificationIds.length === 0) {
      errors.push(`Acceptance criterion ${criterion?.id ?? '<missing id>'} has no verification.`);
      continue;
    }
    for (const id of criterion.verificationIds) {
      if (!verificationIds.has(id)) {
        errors.push(`Acceptance criterion ${criterion?.id ?? '<missing id>'} references missing verification ${id}.`);
      }
    }
  }
  return errors;
}

function scopeErrors(proposal, allowedPathPatterns) {
  const errors = [];
  if (proposal?.authorityBoundary?.mode !== 'proposal-only'
      || (proposal?.authorityBoundary?.requestedCapabilities?.length ?? 0) > 0) {
    errors.push('The learning agent must remain proposal-only and request no additional capabilities.');
  }
  for (const path of proposal?.scope?.allowedPaths ?? []) {
    if (!allowedPathPatterns.some((pattern) => pathMatches(path, pattern))) {
      errors.push(`Proposed path is outside the permitted scope: ${path}.`);
    }
  }
  return errors;
}

function contractErrors(schema, proposal) {
  const errors = validateAgainstSchema(schema, proposal);

  const verifiedIds = new Set();
  for (const claim of proposal?.evidence?.verified ?? []) {
    if (verifiedIds.has(claim.id)) errors.push(`$.evidence.verified: duplicate id ${claim.id}.`);
    verifiedIds.add(claim.id);
  }
  for (const id of proposal?.problem?.evidenceIds ?? []) {
    if (!verifiedIds.has(id)) errors.push(`$.problem.evidenceIds: ${id} is not verified evidence.`);
  }

  const evidenceIds = new Set();
  for (const group of ['verified', 'inferred', 'unknown']) {
    for (const entry of proposal?.evidence?.[group] ?? []) {
      if (evidenceIds.has(entry.id)) errors.push(`$.evidence: duplicate id ${entry.id}.`);
      evidenceIds.add(entry.id);
    }
  }

  const criterionIds = new Set();
  for (const criterion of proposal?.acceptanceCriteria ?? []) {
    if (criterionIds.has(criterion.id)) {
      errors.push(`$.acceptanceCriteria: duplicate id ${criterion.id}.`);
    }
    criterionIds.add(criterion.id);
  }

  const verificationIds = new Set();
  for (const verification of proposal?.verification ?? []) {
    if (verificationIds.has(verification.id)) {
      errors.push(`$.verification: duplicate id ${verification.id}.`);
    }
    verificationIds.add(verification.id);
  }

  const surfaces = (proposal?.deduplication?.searches ?? []).map((search) => search.surface);
  if (surfaces.length > 0
      && (surfaces.length !== REQUIRED_DEDUPLICATION_SURFACES.length
        || new Set(surfaces).size !== REQUIRED_DEDUPLICATION_SURFACES.length
        || REQUIRED_DEDUPLICATION_SURFACES.some((surface) => !surfaces.includes(surface)))) {
    errors.push('$.deduplication.searches: each required search surface must appear exactly once.');
  }
  return errors;
}

export function validateImprovementProposal(schema, proposal, {
  existingIdentities = [],
  allowedPathPatterns = ['**'],
} = {}) {
  const identity = proposal?.deduplication?.identity;
  const recordedMatches = (proposal?.deduplication?.searches ?? [])
    .flatMap((search) => search?.matches ?? []);
  if ((typeof identity === 'string' && existingIdentities.includes(identity))
      || recordedMatches.length > 0) {
    const reasons = recordedMatches.length > 0
      ? [`Deduplication searches found existing work: ${recordedMatches.join(', ')}.`]
      : [`Proposal deduplication identity already exists: ${identity}.`];
    return decision('refused', 'duplicate', reasons);
  }

  const uncited = citationErrors(proposal);
  if (uncited.length > 0) return decision('refused', 'uncited', uncited);

  const untestable = testabilityErrors(proposal);
  if (untestable.length > 0) return decision('refused', 'untestable', untestable);

  const outOfScope = scopeErrors(proposal, allowedPathPatterns);
  if (outOfScope.length > 0) return decision('refused', 'out-of-scope', outOfScope);

  const invalid = contractErrors(schema, proposal);
  if (invalid.length > 0) return decision('refused', 'invalid-contract', invalid);

  return decision('accepted', 'grounded-novel');
}
