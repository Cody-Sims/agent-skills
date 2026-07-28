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

export const BLOCKED_OUTCOME_CODES = Object.freeze([
  'invalid-claim',
  'expired-claim',
  'retry-exhausted',
  'permission-expansion',
  'path-scope-violation',
  'protected-path-change',
  'evaluation-regression',
  'required-check-failed',
  'lease-conflict',
  'run-budget-exhausted',
  'monthly-budget-exhausted',
  'manual-block',
  'invalid-record',
]);

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

function sha256(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function parseTime(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO-8601 timestamp.`);
  return time;
}

function appendTransition(item, { from, to, actor, role, at, reason }) {
  item.transitions.push({ from, to, actor, role, at, reason });
}

export function blockedOutcome(code, message, evidence = []) {
  if (!BLOCKED_OUTCOME_CODES.includes(code)) throw new Error(`Unknown blocked outcome code: ${code}.`);
  return {
    code,
    message,
    evidence: [...evidence],
  };
}

function auditPayload(event) {
  const { eventHash: _eventHash, ...payload } = event;
  return payload;
}

function validateAuditLinks(events) {
  const errors = [];
  for (const [index, event] of events.entries()) {
    const expectedSequence = index + 1;
    const expectedPreviousHash = index === 0 ? null : events[index - 1].eventHash;
    if (event.sequence !== expectedSequence) {
      errors.push(`$[${index}].sequence: expected ${expectedSequence}.`);
    }
    if (event.previousHash !== expectedPreviousHash) {
      errors.push(`$[${index}].previousHash: does not match the previous event hash.`);
    }
    if (event.eventHash !== sha256(auditPayload(event))) {
      errors.push(`$[${index}].eventHash: audit event hash does not match its content.`);
    }
  }
  return errors;
}

export function appendAuditEvent(events, {
  eventType,
  itemId,
  runId = null,
  actor,
  at = new Date().toISOString(),
  outcome = null,
  evidence = [],
  data = {},
}) {
  const existingErrors = validateAuditLinks(events);
  if (existingErrors.length > 0) {
    throw new Error(`Cannot append to an invalid audit trail: ${existingErrors.join(' ')}`);
  }
  const event = {
    schemaVersion: 1,
    sequence: events.length + 1,
    eventType,
    itemId,
    runId,
    actor,
    at,
    outcome: outcome ? clone(outcome) : null,
    evidence: [...evidence],
    data: { ...data },
    previousHash: events.at(-1)?.eventHash ?? null,
    eventHash: null,
  };
  event.eventHash = sha256(auditPayload(event));
  events.push(event);
  return event;
}

export function validateAuditTrail(schema, events) {
  const errors = [];
  if (!Array.isArray(events)) return ['$: expected an array of audit events.'];
  for (const [index, event] of events.entries()) {
    validateAgainstSchema(schema, event, `$[${index}]`, errors);
  }
  errors.push(...validateAuditLinks(events));
  return errors;
}

export class ImprovementControlError extends Error {
  constructor(outcome, auditEvent) {
    super(outcome.message);
    this.name = 'ImprovementControlError';
    this.outcome = outcome;
    this.auditEvent = auditEvent;
  }
}

function throwBlocked({
  code,
  message,
  evidence = [],
  item,
  runId = null,
  actor,
  at,
  auditEvents,
}) {
  const outcome = blockedOutcome(code, message, evidence);
  const target = auditEvents ?? [];
  const auditEvent = appendAuditEvent(target, {
    eventType: 'control-blocked',
    itemId: item.id,
    runId,
    actor,
    at,
    outcome,
    evidence,
  });
  throw new ImprovementControlError(outcome, auditEvent);
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
  if (item.status === 'blocked' && !item.blockedOutcome) {
    errors.push('$.blockedOutcome: blocked items require a typed outcome.');
  }
  if (item.status !== 'blocked' && item.blockedOutcome) {
    errors.push('$.blockedOutcome: only blocked items may include a blocked outcome.');
  }
  return errors;
}

export function approveItem(item, {
  actor,
  now = new Date().toISOString(),
  auditEvents,
}) {
  if (item.status !== 'proposed') throw new Error('Only a proposed item can be approved.');
  const next = clone(item);
  next.status = 'ready';
  next.lease = null;
  next.blockedOutcome = null;
  next.approval = { actor, approvedAt: now, payloadSha256: approvalDigest(next) };
  appendTransition(next, {
    from: 'proposed',
    to: 'ready',
    actor,
    role: 'maintainer',
    at: now,
    reason: 'Maintainer approved the current item payload.',
  });
  if (auditEvents) {
    appendAuditEvent(auditEvents, {
      eventType: 'state-transition',
      itemId: item.id,
      actor,
      at: now,
      evidence: ['proposed->ready'],
      data: { approvalSha256: next.approval.payloadSha256 },
    });
  }
  return next;
}

export function claimItem(item, {
  owner,
  runId,
  policy,
  now = new Date().toISOString(),
  attempt = 1,
  leaseId = randomUUID(),
  auditEvents,
}) {
  const claimed = (auditEvents ?? []).filter((event) => (
    event.eventType === 'claim-acquired'
    && event.itemId === item.id
    && parseTime(event.data.expiresAt, 'Audit lease expiry') > parseTime(now, 'Claim time')
  )).at(-1);
  if (claimed) {
    throwBlocked({
      code: 'lease-conflict',
      message: `Only a ready item can be claimed; the item has a lease conflict with run ${claimed.runId}.`,
      evidence: [`active-run:${claimed.runId}`, `lease:${claimed.data.leaseId}`],
      item,
      runId,
      actor: owner,
      at: now,
      auditEvents,
    });
  }
  if (item.status !== 'ready') {
    const expired = item.status === 'in-progress'
      && item.lease
      && parseTime(item.lease.expiresAt, 'Lease expiry') <= parseTime(now, 'Claim time');
    throwBlocked({
      code: expired ? 'expired-claim' : (item.status === 'in-progress' ? 'lease-conflict' : 'invalid-claim'),
      message: expired
        ? 'Only a ready item can be claimed; the existing claim has expired.'
        : 'Only a ready item can be claimed.',
      evidence: [`status:${item.status}`],
      item,
      runId,
      actor: owner,
      at: now,
      auditEvents,
    });
  }
  if (!item.approval || item.approval.payloadSha256 !== approvalDigest(item)) {
    throwBlocked({
      code: 'invalid-claim',
      message: 'The item has no current maintainer approval.',
      evidence: ['approval:missing-or-stale'],
      item,
      runId,
      actor: owner,
      at: now,
      auditEvents,
    });
  }
  if (attempt > policy.maxRetries + 1) {
    throwBlocked({
      code: 'retry-exhausted',
      message: 'Retry budget exhausted.',
      evidence: [`attempt:${attempt}`, `maximum-attempts:${policy.maxRetries + 1}`],
      item,
      runId,
      actor: owner,
      at: now,
      auditEvents,
    });
  }
  const acquiredAt = parseTime(now, 'Claim time');
  const expiresAt = new Date(acquiredAt + policy.leaseMinutes * 60_000).toISOString();
  const next = clone(item);
  next.status = 'in-progress';
  next.blockedOutcome = null;
  next.lease = { id: leaseId, owner, runId, acquiredAt: now, expiresAt, attempt };
  appendTransition(next, {
    from: 'ready',
    to: 'in-progress',
    actor: owner,
    role: 'improvement-agent',
    at: now,
    reason: `Claimed by run ${runId}.`,
  });
  if (auditEvents) {
    appendAuditEvent(auditEvents, {
      eventType: 'claim-acquired',
      itemId: item.id,
      runId,
      actor: owner,
      at: now,
      evidence: [`attempt:${attempt}`],
      data: { leaseId, expiresAt },
    });
  }
  return next;
}

export function rejectItem(item, {
  actor,
  reason,
  now = new Date().toISOString(),
  auditEvents,
}) {
  if (item.status !== 'proposed') throw new Error('Only a proposed item can be rejected.');
  if (!reason) throw new Error('Rejected items require a reason.');
  const next = clone(item);
  next.status = 'rejected';
  next.lease = null;
  next.blockedOutcome = null;
  appendTransition(next, {
    from: 'proposed',
    to: 'rejected',
    actor,
    role: 'maintainer',
    at: now,
    reason,
  });
  if (auditEvents) {
    appendAuditEvent(auditEvents, {
      eventType: 'state-transition',
      itemId: item.id,
      actor,
      at: now,
      evidence: ['proposed->rejected', reason],
    });
  }
  return next;
}

export function finishItem(item, {
  to,
  actor,
  role,
  reason,
  merged = false,
  now = new Date().toISOString(),
  outcome,
  auditEvents,
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
  next.blockedOutcome = to === 'blocked'
    ? clone(outcome ?? blockedOutcome('manual-block', reason, [reason]))
    : null;
  appendTransition(next, { from: 'in-progress', to, actor, role, at: now, reason });
  if (auditEvents) {
    appendAuditEvent(auditEvents, {
      eventType: to === 'blocked' ? 'control-blocked' : 'state-transition',
      itemId: item.id,
      runId: item.lease?.runId ?? null,
      actor,
      at: now,
      outcome: next.blockedOutcome,
      evidence: [`in-progress->${to}`, reason],
      data: { leaseId: item.lease?.id ?? '' },
    });
  }
  return next;
}

export function expireItem(item, {
  actor,
  role = 'ci',
  now = new Date().toISOString(),
  auditEvents,
}) {
  if (item.status !== 'in-progress' || !item.lease) {
    throw new Error('Only an in-progress item with a lease can expire.');
  }
  if (parseTime(item.lease.expiresAt, 'Lease expiry') > parseTime(now, 'Current time')) {
    throw new Error('The item lease has not expired.');
  }
  return finishItem(item, {
    to: 'blocked',
    actor,
    role,
    reason: 'The item lease expired before completion.',
    outcome: blockedOutcome('expired-claim', 'The item lease expired before completion.', [
      `lease:${item.lease.id}`,
      `expired-at:${item.lease.expiresAt}`,
    ]),
    now,
    auditEvents,
  });
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
  if (run.monthlyUsage) {
    if (run.monthlyUsage.actionsMinutes > policy.maxMonthlyActionsMinutes) {
      errors.push('Monthly Actions budget exceeded.');
    }
    if (run.monthlyUsage.aiCredits > policy.maxMonthlyAiCredits) {
      errors.push('Monthly AI credit budget exceeded.');
    }
  }
  const approvedPermissions = new Set(policy.approvedPermissions ?? []);
  for (const permission of run.permissions) {
    if (!approvedPermissions.has(permission)) {
      errors.push(`Run permission is not approved: ${permission}.`);
    }
  }

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
    else if (run.finalState === 'draft-ready' && result.headCommit !== run.headCommit) {
      errors.push(`Required check is not bound to the current head commit: ${required}.`);
    }
  }
  for (const check of run.checks) {
    if (check.regressed) errors.push(`Evaluation regressed: ${check.name}.`);
    if (run.finalState === 'draft-ready' && !check.passed) {
      errors.push(`Draft-ready check failed: ${check.name}.`);
    }
    if (run.finalState === 'draft-ready' && check.headCommit !== run.headCommit) {
      errors.push(`Draft-ready check is not bound to the current head commit: ${check.name}.`);
    }
  }
  if (!['draft-ready', 'blocked'].includes(run.finalState)) {
    errors.push('Run must have a terminal final state.');
  }
  if (run.finalState === 'draft-ready' && !run.headCommit) {
    errors.push('Draft-ready runs require a head commit.');
  }
  if (run.finalState === 'draft-ready' && !run.monthlyUsage) {
    errors.push('Draft-ready runs require supplied monthly usage totals.');
  }
  if (run.finalState === 'blocked' && !run.stopReason) errors.push('Blocked runs require a stop reason.');
  if (run.finalState === 'blocked' && !run.blockedOutcome) {
    errors.push('Blocked runs require a typed blocked outcome.');
  }
  if (run.finalState !== 'blocked' && run.stopReason) errors.push('Only blocked runs may include a stop reason.');
  if (run.finalState !== 'blocked' && run.blockedOutcome) {
    errors.push('Only blocked runs may include a blocked outcome.');
  }
  return errors;
}

function detectedOutcome({ item, run, policy, itemSchema, runSchema, now }) {
  const itemErrors = validateItem(itemSchema, item);
  const runErrors = validateRun(runSchema, run);
  if (itemErrors.length > 0 || runErrors.length > 0) {
    return blockedOutcome(
      'invalid-record',
      'The item or run record is invalid.',
      [...itemErrors, ...runErrors],
    );
  }
  if (item.status !== 'in-progress' || !item.lease) {
    return blockedOutcome('invalid-claim', 'The run has no valid in-progress claim.', [
      `item-status:${item.status}`,
    ]);
  }
  if (parseTime(item.lease.expiresAt, 'Lease expiry') <= parseTime(now, 'Current time')) {
    return blockedOutcome('expired-claim', 'The item lease has expired.', [
      `lease:${item.lease.id}`,
      `expired-at:${item.lease.expiresAt}`,
    ]);
  }
  if (item.lease.runId !== run.runId || item.lease.id !== run.leaseId || item.id !== run.itemId) {
    return blockedOutcome('lease-conflict', 'The run does not own the active item lease.', [
      `item-lease:${item.lease.id}`,
      `run-lease:${run.leaseId}`,
    ]);
  }
  const unapprovedPermissions = run.permissions.filter(
    (permission) => !(policy.approvedPermissions ?? []).includes(permission),
  );
  if (unapprovedPermissions.length > 0) {
    return blockedOutcome('permission-expansion', 'The run requested permissions outside policy.', [
      ...unapprovedPermissions.map((permission) => `permission:${permission}`),
    ]);
  }
  if (run.usage.retries > policy.maxRetries) {
    return blockedOutcome('retry-exhausted', 'The run retry budget is exhausted.', [
      `retries:${run.usage.retries}`,
      `maximum:${policy.maxRetries}`,
    ]);
  }
  const runBudgets = [
    ['durationMinutes', run.usage.durationMinutes, policy.maxRunMinutes],
    ['actionsMinutes', run.usage.actionsMinutes, policy.maxActionsMinutes],
    ['aiCredits', run.usage.aiCredits, policy.maxAiCredits],
    ['openPullRequests', run.usage.openPullRequests, policy.maxOpenPullRequests],
  ];
  const exceededRunBudgets = runBudgets.filter(([, actual, maximum]) => actual > maximum);
  if (exceededRunBudgets.length > 0) {
    return blockedOutcome('run-budget-exhausted', 'A per-run budget is exhausted.', exceededRunBudgets.map(
      ([name, actual, maximum]) => `${name}:${actual}>${maximum}`,
    ));
  }
  if (run.monthlyUsage) {
    const monthlyBudgets = [
      ['actionsMinutes', run.monthlyUsage.actionsMinutes, policy.maxMonthlyActionsMinutes],
      ['aiCredits', run.monthlyUsage.aiCredits, policy.maxMonthlyAiCredits],
    ];
    const exceededMonthlyBudgets = monthlyBudgets.filter(([, actual, maximum]) => actual > maximum);
    if (exceededMonthlyBudgets.length > 0) {
      return blockedOutcome(
        'monthly-budget-exhausted',
        'A supplied monthly budget total is exhausted.',
        exceededMonthlyBudgets.map(([name, actual, maximum]) => `${name}:${actual}>${maximum}`),
      );
    }
  }
  const unapprovedProtected = run.changedPaths.filter((path) => (
    isProtectedPath(path, policy)
    && !item.approvedProtectedPaths.some((pattern) => pathMatches(path, pattern))
  ));
  if (unapprovedProtected.length > 0) {
    return blockedOutcome(
      'protected-path-change',
      'Protected paths changed without explicit approval.',
      unapprovedProtected,
    );
  }
  const outsideScope = run.changedPaths.filter(
    (path) => !item.allowedPaths.some((pattern) => pathMatches(path, pattern)),
  );
  if (outsideScope.length > 0) {
    return blockedOutcome('path-scope-violation', 'Changed paths exceed the approved scope.', outsideScope);
  }
  const regressions = run.checks.filter((check) => check.regressed);
  if (regressions.length > 0) {
    return blockedOutcome(
      'evaluation-regression',
      'An evaluation regressed.',
      regressions.map((check) => `${check.name}:${check.evidence}`),
    );
  }
  if (run.finalState === 'blocked' && run.blockedOutcome) {
    return clone(run.blockedOutcome);
  }
  const results = new Map(run.checks.map((check) => [check.name, check]));
  const failedRequired = item.requiredChecks.filter((required) => !results.get(required)?.passed);
  if (failedRequired.length > 0) {
    return blockedOutcome(
      'required-check-failed',
      'One or more required checks did not pass.',
      failedRequired,
    );
  }
  return null;
}

export function evaluateRun(options) {
  const now = options.now ?? new Date().toISOString();
  const auditEvents = options.auditEvents ?? [];
  const errors = verifyRun({ ...options, now });
  const outcome = detectedOutcome({ ...options, now });
  if (outcome) {
    appendAuditEvent(auditEvents, {
      eventType: 'control-blocked',
      itemId: options.item.id,
      runId: options.run.runId,
      actor: options.run.agent,
      at: now,
      outcome,
      evidence: errors.length > 0 ? errors : outcome.evidence,
      data: {
        leaseId: options.run.leaseId,
        headCommit: options.run.headCommit ?? '',
      },
    });
  } else if (options.run.finalState === 'draft-ready' && errors.length === 0) {
    appendAuditEvent(auditEvents, {
      eventType: 'run-verified',
      itemId: options.item.id,
      runId: options.run.runId,
      actor: options.run.agent,
      at: now,
      evidence: options.item.requiredChecks.map((check) => `check:${check}`),
      data: {
        leaseId: options.run.leaseId,
        headCommit: options.run.headCommit,
      },
    });
  }
  return { errors, outcome, auditEvents };
}