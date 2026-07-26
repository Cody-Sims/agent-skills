import { createHash, randomUUID } from 'node:crypto';

import { validateAgainstSchema } from './jsonschema.mjs';

const APPROVAL_FIELDS = [
  'schemaVersion',
  'id',
  'title',
  'objective',
  'evidence',
  'expectedBenefit',
  'effort',
  'risk',
  'dependencies',
  'acceptanceCriteria',
  'allowedPaths',
  'approvedProtectedPaths',
  'requiredChecks',
];

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return structuredClone(value);
}

function parseTime(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO-8601 timestamp.`);
  return time;
}

function appendTransition(item, { from, to, actor, role, at, reason }) {
  item.transitions.push({ from, to, actor, role, at, reason });
}

export function approvalPayload(item) {
  return Object.fromEntries(APPROVAL_FIELDS.map((field) => [field, item[field]]));
}

export function approvalDigest(item) {
  return createHash('sha256').update(canonicalize(approvalPayload(item))).digest('hex');
}

export function validateItem(schema, item) {
  const errors = validateAgainstSchema(schema, item);
  if (item.evidence?.length === 0) errors.push('$.evidence: at least one evidence entry is required.');
  if (item.acceptanceCriteria?.length === 0) errors.push('$.acceptanceCriteria: at least one criterion is required.');
  if (item.allowedPaths?.length === 0) errors.push('$.allowedPaths: at least one path is required.');
  if (item.requiredChecks?.length === 0) errors.push('$.requiredChecks: at least one check is required.');
  if (item.transitions?.length === 0) errors.push('$.transitions: at least one transition is required.');
  if (item.transitions?.at(-1)?.to !== item.status) errors.push('$.transitions: final transition must match status.');
  const transitionRoles = new Map([
    ['null->proposed', new Set(['learning-agent', 'maintainer'])],
    ['proposed->ready', new Set(['maintainer'])],
    ['proposed->rejected', new Set(['maintainer'])],
    ['ready->in-progress', new Set(['improvement-agent'])],
    ['in-progress->blocked', new Set(['improvement-agent', 'maintainer', 'ci'])],
    ['in-progress->done', new Set(['maintainer', 'ci'])],
  ]);
  for (const [index, transition] of (item.transitions ?? []).entries()) {
    const expectedFrom = index === 0 ? null : item.transitions[index - 1].to;
    if (transition.from !== expectedFrom) {
      errors.push(`$.transitions[${index}]: from must match the previous state.`);
    }
    const key = `${transition.from}->${transition.to}`;
    if (!transitionRoles.get(key)?.has(transition.role)) {
      errors.push(`$.transitions[${index}]: illegal transition or actor role ${key} (${transition.role}).`);
    }
  }
  if (['ready', 'in-progress', 'done', 'blocked'].includes(item.status)) {
    if (!item.approval) errors.push('$.approval: approved states require maintainer approval.');
    else if (item.approval.payloadSha256 !== approvalDigest(item)) errors.push('$.approval.payloadSha256: approval is stale.');
  }
  const approvalTransition = item.transitions?.find((transition) => transition.from === 'proposed' && transition.to === 'ready');
  if (item.approval && approvalTransition?.actor !== item.approval.actor) {
    errors.push('$.approval.actor: actor must match the maintainer approval transition.');
  }
  if (item.status === 'in-progress' && !item.lease) errors.push('$.lease: in-progress items require a lease.');
  return errors;
}

export function approveItem(item, { actor, now = new Date().toISOString() }) {
  if (item.status !== 'proposed') throw new Error('Only a proposed item can be approved.');
  const next = clone(item);
  next.status = 'ready';
  next.lease = null;
  next.approval = { actor, approvedAt: now, payloadSha256: approvalDigest(next) };
  appendTransition(next, {
    from: 'proposed',
    to: 'ready',
    actor,
    role: 'maintainer',
    at: now,
    reason: 'Maintainer approved the current item payload.',
  });
  return next;
}

export function claimItem(item, {
  owner,
  runId,
  policy,
  now = new Date().toISOString(),
  attempt = 1,
  leaseId = randomUUID(),
}) {
  if (item.status !== 'ready') throw new Error('Only a ready item can be claimed.');
  if (!item.approval || item.approval.payloadSha256 !== approvalDigest(item)) {
    throw new Error('The item has no current maintainer approval.');
  }
  if (attempt > policy.maxRetries + 1) throw new Error('Retry budget exhausted.');
  const acquiredAt = parseTime(now, 'Claim time');
  const expiresAt = new Date(acquiredAt + policy.leaseMinutes * 60_000).toISOString();
  const next = clone(item);
  next.status = 'in-progress';
  next.lease = { id: leaseId, owner, runId, acquiredAt: now, expiresAt, attempt };
  appendTransition(next, {
    from: 'ready',
    to: 'in-progress',
    actor: owner,
    role: 'improvement-agent',
    at: now,
    reason: `Claimed by run ${runId}.`,
  });
  return next;
}

export function finishItem(item, {
  to,
  actor,
  role,
  reason,
  merged = false,
  now = new Date().toISOString(),
}) {
  if (item.status !== 'in-progress') throw new Error('Only an in-progress item can reach a terminal state.');
  if (!['done', 'blocked'].includes(to)) throw new Error('An implementation run can finish only as done or blocked.');
  if (to === 'done' && role !== 'maintainer' && !(role === 'ci' && merged)) {
    throw new Error('Done requires a maintainer or merged-pull-request CI evidence.');
  }
  if (to === 'blocked' && !['improvement-agent', 'maintainer', 'ci'].includes(role)) {
    throw new Error('Only the improvement agent, CI, or a maintainer can block an item.');
  }
  const next = clone(item);
  next.status = to;
  appendTransition(next, { from: 'in-progress', to, actor, role, at: now, reason });
  return next;
}

export function pathMatches(path, pattern) {
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

export function isProtectedPath(path, policy) {
  return policy.protectedPaths.some((pattern) => pathMatches(path, pattern));
}

export function validateRun(schema, run) {
  return validateAgainstSchema(schema, run);
}

export function preflight({ item, run, policy, itemSchema, runSchema, now = new Date().toISOString() }) {
  const errors = [
    ...validateItem(itemSchema, item),
    ...validateRun(runSchema, run),
  ];
  if (item.status !== 'in-progress') errors.push('Item must be in-progress.');
  if (!item.lease) errors.push('Item must have a lease.');
  else {
    if (item.lease.runId !== run.runId) errors.push('Run does not own the item lease.');
    if (item.lease.id !== run.leaseId) errors.push('Run lease ID does not match the item.');
    if (parseTime(item.lease.expiresAt, 'Lease expiry') <= parseTime(now, 'Current time')) errors.push('Item lease has expired.');
  }
  if (item.id !== run.itemId) errors.push('Run item ID does not match the item.');
  if (run.usage.retries > policy.maxRetries) errors.push('Retry budget exceeded.');
  if (run.usage.durationMinutes > policy.maxRunMinutes) errors.push('Run duration budget exceeded.');
  if (run.usage.actionsMinutes > policy.maxActionsMinutes) errors.push('Actions budget exceeded.');
  if (run.usage.aiCredits > policy.maxAiCredits) errors.push('AI credit budget exceeded.');
  if (run.usage.openPullRequests > policy.maxOpenPullRequests) errors.push('Open pull request budget exceeded.');

  for (const path of run.changedPaths) {
    if (!item.allowedPaths.some((pattern) => pathMatches(path, pattern))) {
      errors.push(`Changed path is outside the approved scope: ${path}.`);
    }
    if (isProtectedPath(path, policy)
      && !item.approvedProtectedPaths.some((pattern) => pathMatches(path, pattern))) {
      errors.push(`Protected path lacks explicit approval: ${path}.`);
    }
  }
  return errors;
}

export function verifyRun(options) {
  const errors = preflight(options);
  const { item, run } = options;
  const results = new Map(run.checks.map((check) => [check.name, check]));
  for (const required of item.requiredChecks) {
    const result = results.get(required);
    if (!result) errors.push(`Required check has no result: ${required}.`);
    else if (!result.passed) errors.push(`Required check failed: ${required}.`);
  }
  if (!['draft-ready', 'blocked'].includes(run.finalState)) {
    errors.push('Run must have a terminal final state.');
  }
  if (run.finalState === 'blocked' && !run.stopReason) errors.push('Blocked runs require a stop reason.');
  if (run.finalState !== 'blocked' && run.stopReason) errors.push('Only blocked runs may include a stop reason.');
  return errors;
}