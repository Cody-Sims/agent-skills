#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const TICKET_TYPES = new Set(['research', 'prototype', 'grilling', 'task']);
const TICKET_STATUSES = new Set(['open', 'blocked', 'closed']);
const TASK_OUTCOMES = new Set(['succeeded', 'unknown']);
const RECOVERY_FENCE_KINDS = new Set([
  'reclaim-inspection-required',
  'release-confirmation-required',
]);
const MAX_LEASE_DURATION_MS = 2_592_000_000;
const JOURNAL_GENESIS = 'genesis';
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
const OPERATIONS = new Set([
  'block_ticket',
  'external_action',
  'get_ticket',
  'reclaim_expired_claim',
  'record_progress',
  'record_task_intent',
  'record_task_receipt',
  'release_claim',
  'unblock_ticket',
]);
const MUTATION_OPERATIONS = new Set([
  'block_ticket',
  'external_action',
  'reclaim_expired_claim',
  'record_progress',
  'record_task_intent',
  'record_task_receipt',
  'release_claim',
  'unblock_ticket',
]);
const OPERATION_LIFECYCLES = new Map([
  ['block_ticket', { allowed: new Set(['open']), violation: 'invalid-lifecycle-transition' }],
  ['external_action', {
    allowed: new Set(['open']),
    violation: 'external-action-requires-open-ticket',
  }],
  ['reclaim_expired_claim', {
    allowed: new Set(['open', 'blocked']),
    violation: 'invalid-lifecycle-transition',
  }],
  ['record_progress', {
    allowed: new Set(['open']),
    violation: 'invalid-lifecycle-transition',
  }],
  ['record_task_intent', {
    allowed: new Set(['open']),
    violation: 'invalid-lifecycle-transition',
  }],
  ['record_task_receipt', {
    allowed: new Set(['open']),
    violation: 'invalid-lifecycle-transition',
  }],
  ['release_claim', {
    allowed: new Set(['open', 'blocked']),
    violation: 'invalid-lifecycle-transition',
  }],
  ['unblock_ticket', {
    allowed: new Set(['blocked']),
    violation: 'invalid-lifecycle-transition',
  }],
]);

export const RECOVERY_LIMITS = Object.freeze({
  inputBytes: 262_144,
  tickets: 128,
  operations: 128,
  commentsPerTicket: 64,
  evidencePerTicket: 64,
  progressPerTicket: 64,
  blockHistoryPerTicket: 32,
  blockerIdsPerTicket: 64,
  journalEntries: 128,
  mutationReceipts: 128,
  recoveryConfirmations: 128,
  externalActions: 128,
  ticketBytes: 32_768,
  identifierBytes: 256,
  stringBytes: 4_096,
  payloadBytes: 8_192,
  collectionItems: 128,
  objectKeys: 128,
  jsonDepth: 16,
});

class RecoveryInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecoveryInputError';
    this.code = 'malformed-input';
  }
}

function fail(message) {
  throw new RecoveryInputError(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function compareStrings(left, right) {
  const leftCodePoints = Array.from(left, (character) => character.codePointAt(0));
  const rightCodePoints = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftCodePoints[index] !== rightCodePoints[index]) {
      return leftCodePoints[index] - rightCodePoints[index];
    }
  }
  return leftCodePoints.length - rightCodePoints.length;
}

function compareRecoveryConfirmations(left, right) {
  for (const [leftValue, rightValue] of [
    [left.map_id, right.map_id],
    [left.ticket_id, right.ticket_id],
  ]) {
    const comparison = compareStrings(leftValue, rightValue);
    if (comparison !== 0) return comparison;
  }
  if (left.revision !== right.revision) return left.revision - right.revision;
  return compareStrings(left.fence_kind, right.fence_kind);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function requiredString(value, path, maximumBytes = RECOVERY_LIMITS.stringBytes) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a meaningful non-empty string.`);
  }
  if (byteLength(value) > maximumBytes) {
    fail(`${path} must not exceed ${maximumBytes} UTF-8 bytes.`);
  }
  return value;
}

function stableIdentity(value, path) {
  return requiredString(value, path, RECOVERY_LIMITS.identifierBytes);
}

function isMeaningfulString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalNullableString(value, path) {
  if (value === undefined || value === null) return null;
  return stableIdentity(value, path);
}

function positiveRevision(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${path} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeRevision(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function canonicalValue(value, path = 'value', depth = 0) {
  if (depth > RECOVERY_LIMITS.jsonDepth) {
    fail(`${path} exceeds the maximum JSON depth ${RECOVERY_LIMITS.jsonDepth}.`);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must contain finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > RECOVERY_LIMITS.collectionItems) {
      fail(`${path} must contain at most ${RECOVERY_LIMITS.collectionItems} items.`);
    }
    return value.map((entry, index) => {
      if (entry === undefined) fail(`${path}[${index}] must be valid JSON.`);
      return canonicalValue(entry, `${path}[${index}]`, depth + 1);
    });
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareStrings);
    if (keys.length > RECOVERY_LIMITS.objectKeys) {
      fail(`${path} must contain at most ${RECOVERY_LIMITS.objectKeys} keys.`);
    }
    const result = {};
    for (const key of keys) {
      result[key] = canonicalValue(value[key], `${path}.${key}`, depth + 1);
    }
    return result;
  }
  fail(`${path} must contain only JSON values.`);
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function normalizeBoundedJson(
  value,
  path,
  maximumBytes,
  { rejectWhitespaceStrings = false } = {},
) {
  const normalized = canonicalValue(value, path);
  const inspectStrings = (entry, entryPath) => {
    if (typeof entry === 'string') {
      if (byteLength(entry) > RECOVERY_LIMITS.stringBytes) {
        fail(`${entryPath} must not exceed ${RECOVERY_LIMITS.stringBytes} UTF-8 bytes.`);
      }
      if (rejectWhitespaceStrings && entry.trim().length === 0) {
        fail(`${entryPath} must not be whitespace-only.`);
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((child, index) => inspectStrings(child, `${entryPath}[${index}]`));
      return;
    }
    if (isRecord(entry)) {
      for (const [key, child] of Object.entries(entry)) {
        inspectStrings(child, `${entryPath}.${key}`);
      }
    }
  };
  inspectStrings(normalized, path);
  const size = byteLength(JSON.stringify(normalized));
  if (size > maximumBytes) {
    fail(`${path} must not exceed ${maximumBytes} serialized UTF-8 bytes.`);
  }
  return normalized;
}

function timestamp(value, path) {
  requiredString(value, path, 128);
  const match = RFC3339.exec(value);
  if (!match) {
    fail(`${path} must be a strict RFC 3339 timestamp with Z or ±HH:MM.`);
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fractionText = '',
    zone,
    offsetSign,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  if (fractionText.length > 3) {
    fail(`${path} must not contain more than 3 fractional second digits.`);
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = zone === 'Z' ? 0 : Number(offsetHourText);
  const offsetMinute = zone === 'Z' ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12
      || day < 1 || day > 31
      || hour > 23
      || minute > 59
      || second > 59
      || offsetHour > 23
      || offsetMinute > 59) {
    fail(`${path} must be a real RFC 3339 calendar date and time.`);
  }
  const milliseconds = Number(`${fractionText.slice(0, 3)}000`.slice(0, 3));
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, milliseconds);
  if (calendar.getUTCFullYear() !== year
      || calendar.getUTCMonth() !== month - 1
      || calendar.getUTCDate() !== day
      || calendar.getUTCHours() !== hour
      || calendar.getUTCMinutes() !== minute
      || calendar.getUTCSeconds() !== second) {
    fail(`${path} must be a real RFC 3339 calendar date and time.`);
  }
  const offset = (offsetHour * 60 + offsetMinute) * 60_000;
  const instant = calendar.getTime()
    - (offsetSign === '-' ? -offset : offset);
  if (!Number.isFinite(instant)) fail(`${path} must be a representable timestamp.`);
  const normalized = new Date(instant).toISOString();
  if (!/^\d{4}-/.test(normalized)) {
    fail(`${path} must remain within the four-digit RFC 3339 year range.`);
  }
  return normalized;
}

function normalizeClaim(value, path) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail(`${path} must be an object or null.`);
  const normalized = {
    claim_token: stableIdentity(value.claim_token, `${path}.claim_token`),
    owner_id: stableIdentity(value.owner_id, `${path}.owner_id`),
    session_id: stableIdentity(value.session_id, `${path}.session_id`),
    acquired_at: timestamp(value.acquired_at, `${path}.acquired_at`),
    expires_at: timestamp(value.expires_at, `${path}.expires_at`),
  };
  if (Date.parse(normalized.acquired_at) >= Date.parse(normalized.expires_at)) {
    fail(`${path} claim interval requires acquired_at before expires_at.`);
  }
  return normalized;
}

function normalizeReceipt(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  return {
    external_system: stableIdentity(value.external_system, `${path}.external_system`),
    idempotency_key: stableIdentity(value.idempotency_key, `${path}.idempotency_key`),
    result: requiredString(value.result, `${path}.result`, 32),
    lookup_reference: stableIdentity(
      value.lookup_reference,
      `${path}.lookup_reference`,
    ),
  };
}

function normalizeReconciliationEvidence(value) {
  if (!isRecord(value)
      || !isMeaningfulString(value.authority_reference)
      || !isMeaningfulString(value.conclusion)) {
    return null;
  }
  const normalized = {
    authority_reference: stableIdentity(
      value.authority_reference,
      'reconciliation_evidence.authority_reference',
    ),
    conclusion: requiredString(
      value.conclusion,
      'reconciliation_evidence.conclusion',
    ),
  };
  if (value.task_action !== undefined) {
    if (!isRecord(value.task_action)
        || value.task_action.state !== 'succeeded'
        || !isRecord(value.task_action.receipt)) {
      return null;
    }
    const receipt = normalizeReceipt(
      value.task_action.receipt,
      'reconciliation_evidence.task_action.receipt',
    );
    if (receipt.result !== 'succeeded') return null;
    normalized.task_action = {
      state: 'succeeded',
      receipt,
    };
  }
  return normalized;
}

function normalizeReconciliationAudit(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  if (value.actor_type !== 'human') fail(`${path}.actor_type must be human.`);
  const reconciliationEvidence = normalizeReconciliationEvidence(
    value.reconciliation_evidence,
  );
  if (!reconciliationEvidence) {
    fail(`${path}.reconciliation_evidence must be authoritative and meaningful.`);
  }
  return {
    block_revision: positiveRevision(value.block_revision, `${path}.block_revision`),
    actor_type: 'human',
    actor_id: stableIdentity(value.actor_id, `${path}.actor_id`),
    authorization_reference: stableIdentity(
      value.authorization_reference,
      `${path}.authorization_reference`,
    ),
    reconciliation_evidence: reconciliationEvidence,
    reconciled_at: timestamp(value.reconciled_at, `${path}.reconciled_at`),
    resulting_revision: positiveRevision(
      value.resulting_revision,
      `${path}.resulting_revision`,
    ),
  };
}

function normalizeBlock(value, path) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail(`${path} must be an object or null.`);
  if (value.requires_human_resolution !== true) {
    fail(`${path}.requires_human_resolution must be true.`);
  }
  const normalized = {
    reason: requiredString(value.reason, `${path}.reason`),
    evidence_reference: stableIdentity(
      value.evidence_reference,
      `${path}.evidence_reference`,
    ),
    actor_id: stableIdentity(value.actor_id, `${path}.actor_id`),
    blocked_at: timestamp(value.blocked_at, `${path}.blocked_at`),
    blocked_revision: positiveRevision(
      value.blocked_revision,
      `${path}.blocked_revision`,
    ),
    requires_human_resolution: true,
  };
  if (value.reconciliation !== undefined && value.reconciliation !== null) {
    normalized.reconciliation = normalizeReconciliationAudit(
      value.reconciliation,
      `${path}.reconciliation`,
    );
  }
  return normalized;
}

function normalizeTaskAction(value, path) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail(`${path} must be an object or null.`);
  if (!['intended', 'succeeded', 'outcome_unknown'].includes(value.state)) {
    fail(`${path}.state must be intended, succeeded, or outcome_unknown.`);
  }
  const normalized = {
    intent: requiredString(value.intent, `${path}.intent`),
    idempotency_key: stableIdentity(value.idempotency_key, `${path}.idempotency_key`),
    authorization_reference: stableIdentity(
      value.authorization_reference,
      `${path}.authorization_reference`,
    ),
    reconciliation_method: requiredString(
      value.reconciliation_method,
      `${path}.reconciliation_method`,
    ),
    state: value.state,
  };
  if (value.external_receipt !== undefined && value.external_receipt !== null) {
    normalized.external_receipt = normalizeReceipt(
      value.external_receipt,
      `${path}.external_receipt`,
    );
  }
  if (normalized.state === 'intended' && normalized.external_receipt) {
    fail(`${path}.external_receipt requires a terminal task action state.`);
  }
  if (normalized.state !== 'intended' && !normalized.external_receipt) {
    fail(`${path}.external_receipt is required for a terminal task action state.`);
  }
  if (normalized.external_receipt) {
    if (normalized.external_receipt.idempotency_key !== normalized.idempotency_key) {
      fail(`${path}.external_receipt.idempotency_key must match the task action.`);
    }
    const expectedResult = normalized.state === 'succeeded' ? 'succeeded' : 'unknown';
    if (normalized.external_receipt.result !== expectedResult) {
      fail(`${path}.external_receipt.result must equal ${expectedResult}.`);
    }
  }
  return normalized;
}

function normalizePendingExternalAction(value, path) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail(`${path} must be an object or null.`);
  const outcome = requiredString(value.outcome, `${path}.outcome`, 32);
  if (!TASK_OUTCOMES.has(outcome)) {
    fail(`${path}.outcome must be succeeded or unknown.`);
  }
  if (value.receipt_synchronization_pending !== true) {
    fail(`${path}.receipt_synchronization_pending must be true.`);
  }
  return {
    ticket_id: stableIdentity(value.ticket_id, `${path}.ticket_id`),
    intent: requiredString(value.intent, `${path}.intent`),
    idempotency_key: stableIdentity(value.idempotency_key, `${path}.idempotency_key`),
    claim_token: stableIdentity(value.claim_token, `${path}.claim_token`),
    owner_id: stableIdentity(value.owner_id, `${path}.owner_id`),
    session_id: stableIdentity(value.session_id, `${path}.session_id`),
    external_system: stableIdentity(value.external_system, `${path}.external_system`),
    lookup_reference: stableIdentity(
      value.lookup_reference,
      `${path}.lookup_reference`,
    ),
    outcome,
    performed_at: timestamp(value.performed_at, `${path}.performed_at`),
    receipt_synchronization_pending: true,
  };
}

function normalizeRecoveryHold(value, path) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail(`${path} must be an object or null.`);
  const code = requiredString(value.code, `${path}.code`, 64);
  if (code === 'unknown-external-outcome') {
    return {
      code,
      idempotency_key: stableIdentity(
        value.idempotency_key,
        `${path}.idempotency_key`,
      ),
      evidence_reference: optionalNullableString(
        value.evidence_reference,
        `${path}.evidence_reference`,
      ),
    };
  }
  if (code === 'reclaim-inspection-required'
      || code === 'release-confirmation-required') {
    return {
      code,
      required_at_revision: positiveRevision(
        value.required_at_revision,
        `${path}.required_at_revision`,
      ),
    };
  }
  fail(`${path}.code is not supported.`);
}

function normalizeRecoveryConfirmation(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const fenceKind = requiredString(value.fence_kind, `${path}.fence_kind`, 64);
  if (!RECOVERY_FENCE_KINDS.has(fenceKind)) {
    fail(`${path}.fence_kind is not supported.`);
  }
  if (!isRecord(value.read_result)) {
    fail(`${path}.read_result must be an object.`);
  }
  if (value.read_result.full !== true) {
    fail(`${path}.read_result.full must be true.`);
  }
  const revision = positiveRevision(value.revision, `${path}.revision`);
  const readRevision = positiveRevision(
    value.read_result.ticket_revision,
    `${path}.read_result.ticket_revision`,
  );
  if (readRevision !== revision) {
    fail(`${path}.read_result.ticket_revision must match revision.`);
  }
  if (typeof value.read_result.claim_absent !== 'boolean') {
    fail(`${path}.read_result.claim_absent must be a boolean.`);
  }
  return {
    map_id: stableIdentity(value.map_id, `${path}.map_id`),
    ticket_id: stableIdentity(value.ticket_id, `${path}.ticket_id`),
    revision,
    fence_kind: fenceKind,
    read_result: {
      ticket_revision: readRevision,
      full: true,
      claim_absent: value.read_result.claim_absent,
    },
  };
}

function normalizeProgressRecord(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  if (!isRecord(value.payload)) fail(`${path}.payload must be an object.`);
  return {
    progress_key: stableIdentity(value.progress_key, `${path}.progress_key`),
    payload: normalizeBoundedJson(
      value.payload,
      `${path}.payload`,
      RECOVERY_LIMITS.payloadBytes,
    ),
    recorded_at: timestamp(value.recorded_at, `${path}.recorded_at`),
    revision: positiveRevision(value.revision, `${path}.revision`),
  };
}

function normalizeArray(value, path, limit) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  if (value.length > limit) fail(`${path} must contain at most ${limit} entries.`);
  return value;
}

function normalizeTicket(value, path, now) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  if (byteLength(JSON.stringify(value)) > RECOVERY_LIMITS.ticketBytes) {
    fail(`${path} must not exceed ${RECOVERY_LIMITS.ticketBytes} serialized UTF-8 bytes.`);
  }
  const id = stableIdentity(value.id, `${path}.id`);
  const type = requiredString(value.type, `${path}.type`, 32);
  if (!TICKET_TYPES.has(type)) fail(`${path}.type is not supported.`);
  const status = requiredString(value.status, `${path}.status`, 32);
  if (!TICKET_STATUSES.has(status)) fail(`${path}.status is not supported.`);
  const revision = positiveRevision(value.revision, `${path}.revision`);
  const blockerIds = normalizeArray(
    value.blocker_ids,
    `${path}.blocker_ids`,
    RECOVERY_LIMITS.blockerIdsPerTicket,
  ).map((entry, index) => stableIdentity(entry, `${path}.blocker_ids[${index}]`));
  if (new Set(blockerIds).size !== blockerIds.length) {
    fail(`${path}.blocker_ids contains duplicate blocker IDs.`);
  }
  const block = normalizeBlock(value.block, `${path}.block`);
  if (status === 'blocked' && !block) fail(`${path}.block is required for blocked tickets.`);
  if (status !== 'blocked' && block) {
    fail(`${path}.block is not allowed for ${status} tickets.`);
  }
  if (status === 'blocked' && value.block_history === undefined) {
    fail(`${path}.block_history is required for blocked tickets.`);
  }
  const history = normalizeArray(
    value.block_history,
    `${path}.block_history`,
    RECOVERY_LIMITS.blockHistoryPerTicket,
  ).map((entry, index) => normalizeBlock(entry, `${path}.block_history[${index}]`));
  const blockRevisions = history.map(({ blocked_revision: blockRevision }) => blockRevision);
  if (new Set(blockRevisions).size !== blockRevisions.length) {
    fail(`${path}.block_history contains duplicate block revisions.`);
  }
  for (const [index, historicalBlock] of history.entries()) {
    if (index > 0
        && historicalBlock.blocked_revision <= history[index - 1].blocked_revision) {
      fail(`${path}.block_history must be ordered by increasing block revision.`);
    }
    const reconciliation = historicalBlock.reconciliation;
    if (reconciliation) {
      if (reconciliation.block_revision !== historicalBlock.blocked_revision) {
        fail(`${path}.block_history[${index}].reconciliation block revision must match.`);
      }
      if (reconciliation.resulting_revision <= historicalBlock.blocked_revision) {
        fail(`${path}.block_history[${index}].reconciliation resulting revision must advance.`);
      }
      if (reconciliation.resulting_revision > revision) {
        fail(`${path}.block_history[${index}].reconciliation revision exceeds ticket revision.`);
      }
    }
    if (historicalBlock.blocked_revision > revision) {
      fail(`${path}.block_history[${index}] block revision exceeds ticket revision.`);
    }
    const nextBlock = history[index + 1];
    if (nextBlock && (!reconciliation
        || nextBlock.blocked_revision <= reconciliation.resulting_revision)) {
      fail(`${path}.block_history has an invalid reconciliation revision sequence.`);
    }
  }
  if (block && !history.some((entry) => isDeepStrictEqual(entry, block))) {
    fail(`${path}.block_history must contain the exact active block.`);
  }
  if (block?.reconciliation) {
    fail(`${path}.active block cannot contain a reconciliation audit.`);
  }
  const activeBlockRevision = block?.blocked_revision ?? null;
  for (const [index, historicalBlock] of history.entries()) {
    if (historicalBlock.blocked_revision !== activeBlockRevision
        && !historicalBlock.reconciliation) {
      fail(`${path}.block_history[${index}] requires a reconciliation audit.`);
    }
  }
  const progress = normalizeArray(
    value.progress_records,
    `${path}.progress_records`,
    RECOVERY_LIMITS.progressPerTicket,
  ).map((entry, index) => normalizeProgressRecord(
    entry,
    `${path}.progress_records[${index}]`,
  ));
  const progressKeys = progress.map(({ progress_key: key }) => key);
  if (new Set(progressKeys).size !== progressKeys.length) {
    fail(`${path}.progress_records contains duplicate progress keys.`);
  }
  for (const [index, record] of progress.entries()) {
    if (record.revision > revision) {
      fail(`${path}.progress_records[${index}] revision exceeds ticket revision.`);
    }
    if (Date.parse(record.recorded_at) > Date.parse(now)) {
      fail(`${path}.progress_records[${index}] is recorded in the future.`);
    }
    if (index > 0) {
      const previous = progress[index - 1];
      if (record.revision <= previous.revision) {
        fail(`${path}.progress_records revisions must strictly increase.`);
      }
      if (Date.parse(record.recorded_at) < Date.parse(previous.recorded_at)) {
        fail(`${path}.progress_records timestamps must not move backward.`);
      }
    }
  }
  const taskAction = normalizeTaskAction(value.task_action, `${path}.task_action`);
  if (type !== 'task' && taskAction !== null) {
    fail(`${path}.task_action requires task type.`);
  }
  const claim = normalizeClaim(value.claim, `${path}.claim`);
  const pendingExternalAction = normalizePendingExternalAction(
    value.pending_external_action,
    `${path}.pending_external_action`,
  );
  const recoveryHold = normalizeRecoveryHold(
    value.recovery_hold,
    `${path}.recovery_hold`,
  );
  if (pendingExternalAction) {
    if (status !== 'open' || !claim) {
      fail(`${path}.pending_external_action requires an open claimed ticket.`);
    }
    if (type !== 'task' || !taskAction || taskAction.state !== 'intended') {
      fail(`${path}.pending_external_action requires an intended task action.`);
    }
    if (pendingExternalAction.ticket_id !== id) {
      fail(`${path}.pending_external_action.ticket_id must match the ticket.`);
    }
    if (pendingExternalAction.intent !== taskAction.intent
        || pendingExternalAction.idempotency_key !== taskAction.idempotency_key) {
      fail(`${path}.pending_external_action must match the recorded task intent.`);
    }
    if (pendingExternalAction.claim_token !== claim.claim_token
        || pendingExternalAction.owner_id !== claim.owner_id
        || pendingExternalAction.session_id !== claim.session_id) {
      fail(`${path}.pending_external_action must match the active claim.`);
    }
    if (Date.parse(pendingExternalAction.performed_at) > Date.parse(now)) {
      fail(`${path}.pending_external_action.performed_at cannot be in the future.`);
    }
  }
  if (recoveryHold
      && (recoveryHold.code === 'reclaim-inspection-required'
        || recoveryHold.code === 'release-confirmation-required')
      && recoveryHold.required_at_revision !== revision) {
    fail(`${path}.recovery_hold.required_at_revision must match the ticket revision.`);
  }
  if (recoveryHold?.code === 'release-confirmation-required' && claim !== null) {
    fail(`${path}.release-confirmation-required recovery hold requires an absent claim.`);
  }
  const comments = normalizeArray(
    value.comments,
    `${path}.comments`,
    RECOVERY_LIMITS.commentsPerTicket,
  ).map((entry, index) => normalizeBoundedJson(
    entry,
    `${path}.comments[${index}]`,
    RECOVERY_LIMITS.payloadBytes,
  ));
  const evidence = normalizeArray(
    value.evidence,
    `${path}.evidence`,
    RECOVERY_LIMITS.evidencePerTicket,
  ).map((entry, index) => normalizeBoundedJson(
    entry,
    `${path}.evidence[${index}]`,
    RECOVERY_LIMITS.payloadBytes,
    { rejectWhitespaceStrings: true },
  ));
  if (status === 'closed') {
    if (claim) fail(`${path} closed ticket cannot retain a claim.`);
    if (pendingExternalAction) {
      fail(`${path} closed ticket cannot retain pending_external_action.`);
    }
    if (recoveryHold !== null) {
      fail(`${path} closed ticket cannot retain recovery_hold.`);
    }
    if (taskAction && taskAction.state !== 'succeeded') {
      fail(`${path} closed task_action must be fully reconciled and terminal.`);
    }
  }
  return {
    id,
    parent_map_id: optionalNullableString(value.parent_map_id, `${path}.parent_map_id`),
    type,
    status,
    revision,
    blocker_ids: [...blockerIds].sort(compareStrings),
    claim,
    block,
    block_history: history,
    comments,
    evidence,
    progress_records: progress,
    task_action: taskAction,
    pending_external_action: pendingExternalAction,
    recovery_hold: recoveryHold,
  };
}

function normalizeExternalAction(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const outcome = requiredString(value.outcome, `${path}.outcome`, 32);
  if (!TASK_OUTCOMES.has(outcome)) {
    fail(`${path}.outcome must be succeeded or unknown.`);
  }
  return {
    ticket_id: stableIdentity(value.ticket_id, `${path}.ticket_id`),
    idempotency_key: stableIdentity(value.idempotency_key, `${path}.idempotency_key`),
    external_system: stableIdentity(value.external_system, `${path}.external_system`),
    lookup_reference: stableIdentity(
      value.lookup_reference,
      `${path}.lookup_reference`,
    ),
    outcome,
    performed_at: timestamp(value.performed_at, `${path}.performed_at`),
  };
}

function normalizeInitialState(value, now) {
  const state = value === undefined ? {} : value;
  if (!isRecord(state)) fail('initialState must be an object.');
  const tickets = normalizeArray(
    state.tickets,
    'initialState.tickets',
    RECOVERY_LIMITS.tickets,
  );
  const normalizedTickets = tickets.map((entry, index) =>
    normalizeTicket(entry, `initialState.tickets[${index}]`, now));
  const ids = normalizedTickets.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) fail('initialState.tickets contains duplicate IDs.');
  const ticketsById = new Map(normalizedTickets.map((ticket) => [ticket.id, ticket]));
  for (const ticket of normalizedTickets) {
    if (ticket.parent_map_id === null && ticket.blocker_ids.length > 0) {
      fail(`initialState ticket ${ticket.id} is a non-child and cannot have blockers.`);
    }
    for (const blockerId of ticket.blocker_ids) {
      if (blockerId === ticket.id) {
        fail(`initialState ticket ${ticket.id} has a self blocker link.`);
      }
      const blocker = ticketsById.get(blockerId);
      if (!blocker) {
        fail(`initialState ticket ${ticket.id} references missing blocker ${blockerId}.`);
      }
      if (blocker.parent_map_id === null) {
        fail(`initialState ticket ${ticket.id} references non-child blocker ${blockerId}.`);
      }
      if (ticket.parent_map_id !== blocker.parent_map_id) {
        fail(
          `initialState blocker edge ${ticket.id} -> ${blockerId} crosses parent_map_id boundaries.`,
        );
      }
    }
  }
  const visitState = new Map();
  for (const current of [...normalizedTickets].sort((left, right) =>
    compareStrings(left.id, right.id))) {
    if (visitState.get(current.id) === 2) continue;
    visitState.set(current.id, 1);
    const stack = [{ ticket: current, blockerIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame.blockerIndex >= frame.ticket.blocker_ids.length) {
        visitState.set(frame.ticket.id, 2);
        stack.pop();
        continue;
      }
      const blockerId = frame.ticket.blocker_ids[frame.blockerIndex];
      frame.blockerIndex += 1;
      const blockerState = visitState.get(blockerId) ?? 0;
      if (blockerState === 1) {
        fail(`initialState blocker graph contains a directed cycle at ${blockerId}.`);
      }
      if (blockerState === 0) {
        visitState.set(blockerId, 1);
        stack.push({ ticket: ticketsById.get(blockerId), blockerIndex: 0 });
      }
    }
  }
  const externalActions = normalizeArray(
    state.external_actions,
    'initialState.external_actions',
    RECOVERY_LIMITS.externalActions,
  ).map((entry, index) => normalizeExternalAction(
    entry,
    `initialState.external_actions[${index}]`,
  ));
  const recoveryConfirmations = normalizeArray(
    state.recovery_confirmations,
    'initialState.recovery_confirmations',
    RECOVERY_LIMITS.recoveryConfirmations,
  ).map((entry, index) => normalizeRecoveryConfirmation(
    entry,
    `initialState.recovery_confirmations[${index}]`,
  ));
  recoveryConfirmations.sort(compareRecoveryConfirmations);
  const mutationReceipts = normalizeArray(
    state.mutation_receipts,
    'initialState.mutation_receipts',
    RECOVERY_LIMITS.mutationReceipts,
  ).map((entry, index) => normalizeMutationReceipt(
    entry,
    `initialState.mutation_receipts[${index}]`,
  ));
  const mutationReceiptKeys = mutationReceipts.map(({ mutation_key: key }) => key);
  if (new Set(mutationReceiptKeys).size !== mutationReceiptKeys.length) {
    fail('initialState.mutation_receipts contains duplicate mutation keys.');
  }
  mutationReceipts.sort((left, right) => compareStrings(left.mutation_key, right.mutation_key));
  return {
    tickets: normalizedTickets.sort((left, right) => compareStrings(left.id, right.id)),
    external_actions: externalActions,
    ...(state.recovery_confirmations === undefined || recoveryConfirmations.length === 0
      ? {}
      : { recovery_confirmations: recoveryConfirmations }),
    ...(state.mutation_receipts === undefined || mutationReceipts.length === 0
      ? {}
      : { mutation_receipts: mutationReceipts }),
  };
}

function normalizeMutationResult(value, operation, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const ticketRevision = positiveRevision(
    value.ticket_revision,
    `${path}.ticket_revision`,
  );
  switch (operation) {
    case 'record_progress': {
      const recordRevision = positiveRevision(
        value.record_revision,
        `${path}.record_revision`,
      );
      if (recordRevision > ticketRevision) {
        fail(`${path}.record_revision must not exceed ticket_revision.`);
      }
      if (value.no_op !== undefined && value.no_op !== true) {
        fail(`${path}.no_op must be true when present.`);
      }
      const noOp = value.no_op === true;
      return {
        ticket_revision: ticketRevision,
        progress_key: stableIdentity(value.progress_key, `${path}.progress_key`),
        record_revision: recordRevision,
        ...(noOp
          ? {
            recorded_at: timestamp(value.recorded_at, `${path}.recorded_at`),
            no_op: true,
          }
          : {}),
      };
    }
    case 'record_task_intent':
      return {
        ticket_revision: ticketRevision,
        idempotency_key: stableIdentity(
          value.idempotency_key,
          `${path}.idempotency_key`,
        ),
      };
    case 'external_action': {
      if (!Number.isSafeInteger(value.external_action_count)
          || value.external_action_count < 1) {
        fail(`${path}.external_action_count must be a positive safe integer.`);
      }
      return {
        ticket_revision: ticketRevision,
        idempotency_key: stableIdentity(
          value.idempotency_key,
          `${path}.idempotency_key`,
        ),
        external_action_count: value.external_action_count,
      };
    }
    case 'record_task_receipt': {
      const outcome = requiredString(value.outcome, `${path}.outcome`, 32);
      if (!TASK_OUTCOMES.has(outcome)) {
        fail(`${path}.outcome must be succeeded or unknown.`);
      }
      return {
        ticket_revision: ticketRevision,
        idempotency_key: stableIdentity(
          value.idempotency_key,
          `${path}.idempotency_key`,
        ),
        outcome,
        ...(Object.hasOwn(value, 'previous_pending_external_action')
          ? {
            previous_pending_external_action: normalizePendingExternalAction(
              value.previous_pending_external_action,
              `${path}.previous_pending_external_action`,
            ),
          }
          : {}),
      };
    }
    case 'block_ticket': {
      const blockedRevision = positiveRevision(
        value.blocked_revision,
        `${path}.blocked_revision`,
      );
      if (blockedRevision !== ticketRevision) {
        fail(`${path}.blocked_revision must equal ticket_revision.`);
      }
      return {
        ticket_revision: ticketRevision,
        blocked_revision: blockedRevision,
      };
    }
    case 'release_claim':
      if (value.claim_absent !== true) {
        fail(`${path}.claim_absent must be true.`);
      }
      return {
        ticket_revision: ticketRevision,
        claim_absent: true,
        event_at: timestamp(value.event_at, `${path}.event_at`),
        ...(Object.hasOwn(value, 'inspection_revision')
          ? {
            inspection_revision: positiveRevision(
              value.inspection_revision,
              `${path}.inspection_revision`,
            ),
          }
          : {}),
        ...(Object.hasOwn(value, 'previous_claim')
          ? { previous_claim: normalizeClaim(value.previous_claim, `${path}.previous_claim`) }
          : {}),
      };
    case 'unblock_ticket': {
      const blockRevision = positiveRevision(
        value.block_revision,
        `${path}.block_revision`,
      );
      if (blockRevision >= ticketRevision) {
        fail(`${path}.block_revision must precede ticket_revision.`);
      }
      return {
        ticket_revision: ticketRevision,
        block_revision: blockRevision,
        ...(Object.hasOwn(value, 'previous_task_action')
          ? {
            previous_task_action: normalizeTaskAction(
              value.previous_task_action,
              `${path}.previous_task_action`,
            ),
          }
          : {}),
      };
    }
    case 'reclaim_expired_claim':
      return {
        ticket_revision: ticketRevision,
        claim_token: stableIdentity(value.claim_token, `${path}.claim_token`),
        expires_at: timestamp(value.expires_at, `${path}.expires_at`),
        ...(Object.hasOwn(value, 'previous_claim')
          ? {
            previous_claim: normalizeClaim(
              value.previous_claim,
              `${path}.previous_claim`,
            ),
          }
          : {}),
      };
    default:
      fail(`${path} has unsupported mutation operation ${operation}.`);
  }
}

function requiredDigest(value, path) {
  const digest = requiredString(value, path, 64);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    fail(`${path} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function normalizeMutationReceipt(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const operation = requiredString(value.operation, `${path}.operation`, 64);
  if (!['record_task_intent', 'record_task_receipt'].includes(operation)) {
    fail(`${path}.operation must be a no-op-capable mutation.`);
  }
  const journalSequence = value.journal_sequence === undefined
    ? 0
    : nonNegativeRevision(value.journal_sequence, `${path}.journal_sequence`);
  if (journalSequence > RECOVERY_LIMITS.journalEntries) {
    fail(
      `${path}.journal_sequence must not exceed ${RECOVERY_LIMITS.journalEntries}.`,
    );
  }
  return {
    mutation_key: stableIdentity(value.mutation_key, `${path}.mutation_key`),
    operation,
    ticket_id: stableIdentity(value.ticket_id, `${path}.ticket_id`),
    map_id: stableIdentity(value.map_id, `${path}.map_id`),
    journal_sequence: journalSequence,
    fingerprint_sha256: requiredDigest(
      value.fingerprint_sha256,
      `${path}.fingerprint_sha256`,
    ),
    result: normalizeMutationResult(value.result, operation, `${path}.result`),
  };
}

function normalizeMutationJournal(value) {
  const entries = normalizeArray(
    value,
    'mutationJournal',
    RECOVERY_LIMITS.journalEntries,
  );
  const normalized = entries.map((entry, index) => {
    const path = `mutationJournal[${index}]`;
    if (!isRecord(entry)) fail(`${path} must be an object.`);
    const operation = requiredString(entry.operation, `${path}.operation`, 64);
    if (!MUTATION_OPERATIONS.has(operation)) {
      fail(`${path}.operation is not a modeled mutation.`);
    }
    const fingerprint = requiredString(
      entry.fingerprint_sha256,
      `${path}.fingerprint_sha256`,
      64,
    );
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      fail(`${path}.fingerprint_sha256 must be a lowercase SHA-256 digest.`);
    }
    const mapId = stableIdentity(entry.map_id, `${path}.map_id`);
    const beforeStateSha256 = requiredDigest(
      entry.before_state_sha256,
      `${path}.before_state_sha256`,
    );
    const afterStateSha256 = requiredDigest(
      entry.after_state_sha256,
      `${path}.after_state_sha256`,
    );
    const mutationKey = stableIdentity(entry.mutation_key, `${path}.mutation_key`);
    const ticketId = stableIdentity(entry.ticket_id, `${path}.ticket_id`);
    if (entry.operation_input === undefined) {
      fail(`${path}.operation_input is required.`);
    }
    const operationInput = normalizeOperations([entry.operation_input])[0];
    if (operationInput.operation !== operation
        || operationInput.mutation_key !== mutationKey
        || operationInput.ticket_id !== ticketId
        || fingerprint !== operationFingerprint(operationInput)) {
      fail(`${path}.operation_input does not match its journal bindings.`);
    }
    const normalizeConfirmationSnapshot = (snapshot, snapshotPath) => {
      if (snapshot === undefined) return null;
      return normalizeArray(
        snapshot,
        snapshotPath,
        RECOVERY_LIMITS.recoveryConfirmations,
      ).map((confirmation, confirmationIndex) => normalizeRecoveryConfirmation(
        confirmation,
        `${snapshotPath}[${confirmationIndex}]`,
      )).sort(compareRecoveryConfirmations);
    };
    return {
      sequence: positiveRevision(entry.sequence, `${path}.sequence`),
      previous_entry_sha256: requiredString(
        entry.previous_entry_sha256,
        `${path}.previous_entry_sha256`,
        64,
      ),
      mutation_key: mutationKey,
      operation,
      ticket_id: ticketId,
      fingerprint_sha256: fingerprint,
      map_id: mapId,
      before_state_sha256: beforeStateSha256,
      after_state_sha256: afterStateSha256,
      committed_at: timestamp(entry.committed_at, `${path}.committed_at`),
      operation_input: operationInput,
      before_recovery_confirmations: normalizeConfirmationSnapshot(
        entry.before_recovery_confirmations,
        `${path}.before_recovery_confirmations`,
      ),
      after_recovery_confirmations: normalizeConfirmationSnapshot(
        entry.after_recovery_confirmations,
        `${path}.after_recovery_confirmations`,
      ),
      result: normalizeMutationResult(
        entry.result,
        operation,
        `${path}.result`,
      ),
    };
  });
  const keys = normalized.map(({ mutation_key: key }) => key);
  if (new Set(keys).size !== keys.length) {
    fail('mutationJournal contains duplicate mutation keys.');
  }
  for (const [index, entry] of normalized.entries()) {
    if (entry.sequence !== index + 1) {
      fail(`mutationJournal[${index}].sequence must equal ${index + 1}.`);
    }
    const expectedPrevious = index === 0
      ? JOURNAL_GENESIS
      : sha256(normalized[index - 1]);
    if (entry.previous_entry_sha256 !== expectedPrevious) {
      fail(`mutationJournal[${index}].previous_entry_sha256 does not match its predecessor.`);
    }
  }
  return normalized;
}

function normalizeOperations(value) {
  const operations = normalizeArray(value, 'operations', RECOVERY_LIMITS.operations);
  return operations.map((entry, index) => {
    if (!isRecord(entry)) fail(`operations[${index}] must be an object.`);
    const bounded = normalizeBoundedJson(
      entry,
      `operations[${index}]`,
      16_384,
    );
    const operation = requiredString(
      bounded.operation,
      `operations[${index}].operation`,
      64,
    );
    if (!OPERATIONS.has(operation)) {
      fail(`operations[${index}] has unknown operation ${operation}.`);
    }
    const normalized = {
      ...bounded,
      operation,
      ticket_id: stableIdentity(
        bounded.ticket_id,
        `operations[${index}].ticket_id`,
      ),
    };
    delete normalized.after;
    if (MUTATION_OPERATIONS.has(operation)) {
      normalized.mutation_key = stableIdentity(
        bounded.mutation_key,
        `operations[${index}].mutation_key`,
      );
      if (operation === 'external_action'
          && bounded.idempotency_key !== undefined
          && normalized.mutation_key !== bounded.idempotency_key) {
        fail('external_action.mutation_key must equal its stable idempotency_key.');
      }
    }
    return normalized;
  });
}

function inputSize(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('input must be serializable JSON.');
  }
  if (serialized === undefined) fail('input must be a JSON object.');
  const size = byteLength(serialized);
  if (size > RECOVERY_LIMITS.inputBytes) {
    fail(`input must not exceed ${RECOVERY_LIMITS.inputBytes} serialized UTF-8 bytes.`);
  }
}

function normalizeInput(input) {
  inputSize(input);
  if (!isRecord(input)) fail('input must be a JSON object.');
  if (input.schemaVersion !== SCHEMA_VERSION) {
    fail(`schemaVersion must equal ${SCHEMA_VERSION}.`);
  }
  const now = timestamp(input.now, 'now');
  const mapId = stableIdentity(input.map_id, 'map_id');
  const initialState = normalizeInitialState(input.initialState, now);
  const operations = normalizeOperations(input.operations);
  const mutationJournal = normalizeMutationJournal(input.mutationJournal);
  return {
    schemaVersion: SCHEMA_VERSION,
    map_id: mapId,
    now,
    initialState,
    operations,
    mutationJournal,
  };
}

function addViolation(violations, code) {
  if (!violations.includes(code)) violations.push(code);
}

function ticketIndexById(state, ticketId) {
  return state.tickets.findIndex((entry) => entry.id === ticketId);
}

function scopedTicket(state, operation, mapId, violations) {
  const index = ticketIndexById(state, operation.ticket_id);
  if (index === -1) {
    addViolation(violations, 'ticket-not-found');
    return null;
  }
  const ticket = state.tickets[index];
  if (ticket.parent_map_id !== mapId) {
    addViolation(violations, 'ticket-outside-selected-map');
    return null;
  }
  return { index, ticket };
}

function expectedRevisionMatches(ticket, operation, violations) {
  const expected = operation.expected_revision;
  if (!Number.isSafeInteger(expected) || expected < 1 || expected !== ticket.revision) {
    addViolation(violations, 'stale-revision');
    return false;
  }
  return true;
}

function activeClaimMatches(ticket, operation, now, violations) {
  const currentClaim = ticket.claim;
  const nowMilliseconds = Date.parse(now);
  if (!currentClaim
      || currentClaim.claim_token !== operation.claim_token
      || currentClaim.owner_id !== operation.owner_id
      || currentClaim.session_id !== operation.session_id
      || Date.parse(currentClaim.acquired_at) > nowMilliseconds
      || Date.parse(currentClaim.expires_at) <= nowMilliseconds) {
    addViolation(violations, 'claim-conflict');
    return false;
  }
  return true;
}

function lifecycleAllows(ticket, operation, violations) {
  const lifecycle = OPERATION_LIFECYCLES.get(operation.operation);
  if (!lifecycle || lifecycle.allowed.has(ticket.status)) return true;
  addViolation(violations, lifecycle.violation);
  return false;
}

function nextRevision(ticket, violations) {
  if (ticket.revision === Number.MAX_SAFE_INTEGER) {
    addViolation(violations, 'revision-exhausted');
    return null;
  }
  return ticket.revision + 1;
}

function unknownOutcome(ticket) {
  return ticket.task_action?.state === 'outcome_unknown';
}

function setUnknownOutcomeHold(ticket) {
  if (!unknownOutcome(ticket)) return;
  ticket.recovery_hold = {
    code: 'unknown-external-outcome',
    idempotency_key: ticket.task_action.idempotency_key,
    evidence_reference: ticket.task_action.external_receipt?.lookup_reference ?? null,
  };
}

function operationFingerprint(operation) {
  return sha256(operation);
}

function journalResult(operation, result, beforeState, committedAt) {
  const ticket = beforeState.tickets.find(({ id }) => id === operation.ticket_id);
  if (!ticket) return result;
  switch (operation.operation) {
    case 'release_claim':
    case 'reclaim_expired_claim':
      return {
        ...result,
        previous_claim: clone(ticket.claim),
        ...(operation.operation === 'release_claim'
          ? { event_at: committedAt }
          : {}),
        ...(operation.operation === 'release_claim' && unknownOutcome(ticket)
          ? { inspection_revision: ticket.revision }
          : {}),
      };
    case 'unblock_ticket':
      return {
        ...result,
        previous_task_action: clone(ticket.task_action),
      };
    case 'record_task_receipt':
      return {
        ...result,
        previous_pending_external_action: clone(ticket.pending_external_action),
      };
    default:
      return result;
  }
}

function restorePreState(state, operation, result) {
  const before = clone(state);
  const ticket = before.tickets.find(({ id }) => id === operation.ticket_id);
  if (!ticket || result.ticket_revision !== ticket.revision) return null;
  if (result.ticket_revision === operation.expected_revision) return before;
  if (result.ticket_revision !== operation.expected_revision + 1) return null;

  switch (operation.operation) {
    case 'record_progress': {
      const index = ticket.progress_records.findIndex(({ progress_key: key }) =>
        key === operation.progress_key);
      const record = index === ticket.progress_records.length - 1
        ? ticket.progress_records[index]
        : null;
      if (!record
          || record.revision !== result.record_revision
          || !isDeepStrictEqual(record.payload, operation.payload)) {
        return null;
      }
      ticket.progress_records.splice(index, 1);
      ticket.revision = operation.expected_revision;
      return before;
    }
    case 'record_task_intent':
      if (ticket.task_action === null
          || ticket.task_action.state !== 'intended'
          || ticket.task_action.intent !== operation.intent
          || ticket.task_action.idempotency_key !== operation.idempotency_key
          || ticket.task_action.authorization_reference
            !== operation.authorization_reference
          || ticket.task_action.reconciliation_method
            !== operation.reconciliation_method) {
        return null;
      }
      ticket.task_action = null;
      ticket.revision = operation.expected_revision;
      return before;
    case 'external_action': {
      const action = before.external_actions.at(-1);
      const pending = ticket.pending_external_action;
      if (!action
          || action.ticket_id !== ticket.id
          || action.idempotency_key !== operation.idempotency_key
          || action.external_system !== operation.external_system
          || action.lookup_reference !== operation.lookup_reference
          || action.outcome !== operation.outcome
          || !pending
          || pending.idempotency_key !== operation.idempotency_key
          || pending.external_system !== operation.external_system
          || pending.lookup_reference !== operation.lookup_reference
          || pending.outcome !== operation.outcome) {
        return null;
      }
      before.external_actions.pop();
      ticket.pending_external_action = null;
      ticket.revision = operation.expected_revision;
      return before;
    }
    case 'record_task_receipt': {
      const action = ticket.task_action;
      if (!action?.external_receipt
          || !isDeepStrictEqual(action.external_receipt, operation.receipt)
          || action.state
            !== (operation.outcome === 'succeeded' ? 'succeeded' : 'outcome_unknown')
          || ticket.pending_external_action !== null
          || !ticket.claim) {
        return null;
      }
      ticket.task_action = {
        ...action,
        state: 'intended',
      };
      delete ticket.task_action.external_receipt;
      if (!Object.hasOwn(result, 'previous_pending_external_action')) return null;
      ticket.pending_external_action = clone(result.previous_pending_external_action);
      ticket.recovery_hold = null;
      ticket.revision = operation.expected_revision;
      return before;
    }
    case 'block_ticket': {
      const block = ticket.block;
      if (ticket.status !== 'blocked'
          || !block
          || block.blocked_revision !== result.blocked_revision
          || block.reason !== operation.reason
          || block.evidence_reference !== operation.evidence_reference
          || block.actor_id !== operation.actor_id
          || ticket.block_history.at(-1)?.blocked_revision
            !== result.blocked_revision) {
        return null;
      }
      ticket.status = 'open';
      ticket.block = null;
      ticket.block_history.pop();
      ticket.recovery_hold = unknownOutcome(ticket)
        ? {
          code: 'unknown-external-outcome',
          idempotency_key: ticket.task_action.idempotency_key,
          evidence_reference: ticket.task_action.external_receipt?.lookup_reference ?? null,
        }
        : null;
      ticket.revision = operation.expected_revision;
      return before;
    }
    case 'release_claim':
      if (ticket.claim !== null
          || (ticket.recovery_hold !== null
            && ticket.recovery_hold?.code !== 'release-confirmation-required')) {
        return null;
      }
      ticket.claim = clone(result.previous_claim);
      ticket.recovery_hold = null;
      ticket.revision = operation.expected_revision;
      return before;
    case 'unblock_ticket': {
      const historicalBlock = ticket.block_history.find(({ blocked_revision: revision }) =>
        revision === operation.block_revision);
      if (ticket.status !== 'open'
          || ticket.block !== null
          || !historicalBlock?.reconciliation) {
        return null;
      }
      const restoredBlock = clone(historicalBlock);
      delete restoredBlock.reconciliation;
      ticket.block_history = ticket.block_history.map((entry) =>
        entry.blocked_revision === operation.block_revision ? restoredBlock : entry);
      ticket.status = 'blocked';
      ticket.block = restoredBlock;
      if (!Object.hasOwn(result, 'previous_task_action')) return null;
      ticket.task_action = clone(result.previous_task_action);
      ticket.recovery_hold = null;
      ticket.revision = operation.expected_revision;
      return before;
    }
    case 'reclaim_expired_claim': {
      if (!ticket.claim
          || ticket.claim.claim_token !== result.claim_token
          || ticket.claim.expires_at !== result.expires_at
          || !result.previous_claim) {
        return null;
      }
      ticket.claim = clone(result.previous_claim);
      if (ticket.pending_external_action) {
        ticket.pending_external_action = {
          ...ticket.pending_external_action,
          claim_token: ticket.claim.claim_token,
          owner_id: ticket.claim.owner_id,
          session_id: ticket.claim.session_id,
        };
      }
      ticket.recovery_hold = null;
      ticket.revision = operation.expected_revision;
      return before;
    }
    default:
      return null;
  }
}

function replayResultMatchesState(entry, operation, state, mapId) {
  const ticket = state.tickets.find(({ id }) => id === operation.ticket_id);
  if (!ticket || ticket.parent_map_id !== mapId
      || entry.result.ticket_revision !== ticket.revision) {
    return false;
  }
  switch (operation.operation) {
    case 'record_progress': {
      const record = ticket.progress_records.find(({ progress_key: key }) =>
        key === operation.progress_key);
      return record !== undefined
        && entry.result.progress_key === operation.progress_key
        && entry.result.record_revision === record.revision
        && isDeepStrictEqual(record.payload, operation.payload)
        && (entry.result.no_op !== true
          || (entry.result.ticket_revision === operation.expected_revision
            && entry.result.recorded_at === record.recorded_at));
    }
    case 'record_task_intent':
      return ticket.task_action !== null
        && ticket.task_action.state === 'intended'
        && ticket.task_action.intent === operation.intent
        && ticket.task_action.idempotency_key === operation.idempotency_key
        && ticket.task_action.authorization_reference === operation.authorization_reference
        && ticket.task_action.reconciliation_method === operation.reconciliation_method
        && entry.result.idempotency_key === operation.idempotency_key;
    case 'external_action': {
      const action = state.external_actions.find((candidate) =>
        candidate.ticket_id === ticket.id
          && candidate.idempotency_key === operation.idempotency_key);
      const pending = ticket.pending_external_action;
      return action !== undefined
        && action.external_system === operation.external_system
        && action.lookup_reference === operation.lookup_reference
        && action.outcome === operation.outcome
        && pending !== null
        && pending.idempotency_key === operation.idempotency_key
        && pending.external_system === operation.external_system
        && pending.lookup_reference === operation.lookup_reference
        && pending.outcome === operation.outcome
        && entry.result.idempotency_key === operation.idempotency_key
        && entry.result.external_action_count === state.external_actions.length;
    }
    case 'record_task_receipt': {
      const receipt = ticket.task_action?.external_receipt;
      return receipt !== undefined
        && isDeepStrictEqual(receipt, operation.receipt)
        && ticket.task_action.state
          === (operation.outcome === 'succeeded' ? 'succeeded' : 'outcome_unknown')
        && ticket.pending_external_action === null
        && entry.result.idempotency_key === operation.idempotency_key
        && entry.result.outcome === operation.outcome;
    }
    case 'block_ticket': {
      const block = ticket.block;
      return ticket.status === 'blocked'
        && block !== null
        && block.blocked_revision === entry.result.blocked_revision
        && block.reason === operation.reason
        && block.evidence_reference === operation.evidence_reference
        && block.actor_id === operation.actor_id
        && entry.result.ticket_revision === entry.result.blocked_revision;
    }
    case 'release_claim':
      return ticket.claim === null
        && entry.result.claim_absent === true;
    case 'unblock_ticket': {
      const historicalBlock = ticket.block_history.find(({ blocked_revision: revision }) =>
        revision === operation.block_revision);
      const reconciliation = historicalBlock?.reconciliation;
      return ticket.status === 'open'
        && ticket.block === null
        && reconciliation !== undefined
        && reconciliation.resulting_revision === ticket.revision
        && entry.result.block_revision === operation.block_revision;
    }
    case 'reclaim_expired_claim':
      return ticket.claim !== null
        && ticket.claim.claim_token === entry.result.claim_token
        && ticket.claim.expires_at === entry.result.expires_at
        && ticket.claim.owner_id === operation.owner_id
        && ticket.claim.session_id === operation.session_id;
    default:
      return false;
  }
}

function claimWasActiveAt(ticket, at) {
  const claim = ticket?.claim;
  if (!claim) return false;
  const instant = Date.parse(at);
  return Date.parse(claim.acquired_at) <= instant
    && instant < Date.parse(claim.expires_at);
}

function replayTimestampMatchesState(entry, operation, state, beforeState) {
  const ticket = state.tickets.find(({ id }) => id === operation.ticket_id);
  const beforeTicket = beforeState.tickets.find(({ id }) => id === operation.ticket_id);
  if (!ticket || !beforeTicket) return false;
  switch (operation.operation) {
    case 'record_progress': {
      const record = ticket.progress_records.find(({ progress_key: key }) =>
          key === operation.progress_key);
      if (entry.result.no_op === true) {
        return record?.recorded_at === entry.result.recorded_at
          && record.recorded_at === entry.committed_at
          && claimWasActiveAt(beforeTicket, entry.committed_at);
      }
      return record?.recorded_at === entry.committed_at
          && claimWasActiveAt(beforeTicket, entry.committed_at);
    }
    case 'external_action': {
      const action = state.external_actions.find((candidate) =>
          candidate.ticket_id === ticket.id
          && candidate.idempotency_key === operation.idempotency_key);
      const pending = ticket.pending_external_action;
      return action?.performed_at === entry.committed_at
          && pending?.performed_at === entry.committed_at
          && claimWasActiveAt(beforeTicket, entry.committed_at);
    }
    case 'block_ticket':
      return ticket.block?.blocked_at === entry.committed_at
          && claimWasActiveAt(beforeTicket, entry.committed_at);
    case 'unblock_ticket': {
      const historicalBlock = ticket.block_history.find(({ blocked_revision: revision }) =>
          revision === operation.block_revision);
      return historicalBlock?.reconciliation?.reconciled_at === entry.committed_at;
    }
    case 'reclaim_expired_claim':
      return ticket.claim?.acquired_at === entry.committed_at;
    case 'record_task_intent':
      if (entry.result.ticket_revision === operation.expected_revision) return false;
      return claimWasActiveAt(beforeTicket, entry.committed_at);
    case 'record_task_receipt':
      if (entry.result.ticket_revision === operation.expected_revision) {
        const action = beforeState.external_actions.find((candidate) =>
          candidate.ticket_id === ticket.id
            && candidate.idempotency_key === operation.idempotency_key);
        return action?.performed_at === entry.committed_at
          && claimWasActiveAt(beforeTicket, entry.committed_at);
      }
      return claimWasActiveAt(beforeTicket, entry.committed_at);
    case 'release_claim':
      return entry.result.event_at === entry.committed_at
        && claimWasActiveAt(beforeTicket, entry.committed_at);
    default:
      return true;
  }
}

function replayStateForJournal(entry, state, operation, mapId) {
  if (entry.after_state_sha256 === sha256(state)) return state;
  if (!['release_claim', 'reclaim_expired_claim'].includes(entry.operation)
      || entry.operation !== operation.operation) {
    return null;
  }
  const ticket = state.tickets.find(({ id }) => id === entry.ticket_id);
  if (!ticket
      || ticket.parent_map_id !== mapId
      || ticket.revision !== entry.result.ticket_revision) {
    return null;
  }
  const confirmations = state.recovery_confirmations ?? [];
  const matchingIndexes = confirmations
    .map((confirmation, index) =>
      confirmationMatchesFenceJournal(confirmation, entry, mapId) ? index : -1)
    .filter((index) => index >= 0);
  if (ticket.recovery_hold === null && matchingIndexes.length !== 1) return null;
  if (ticket.recovery_hold !== null
      && (ticket.recovery_hold.code !== fenceCode(entry.operation)
        || ticket.recovery_hold.required_at_revision !== entry.result.ticket_revision)
      ) {
    return null;
  }

  const normalized = clone(state);
  const normalizedTicket = normalized.tickets.find(({ id }) => id === entry.ticket_id);
  if (normalizedTicket.recovery_hold === null) {
    normalizedTicket.recovery_hold = {
      code: fenceCode(entry.operation),
      required_at_revision: entry.result.ticket_revision,
    };
    const matchingIndex = matchingIndexes[0];
    const remainingConfirmations = confirmations.filter((_, index) => index !== matchingIndex);
    if (remainingConfirmations.length === 0) {
      delete normalized.recovery_confirmations;
    } else {
      normalized.recovery_confirmations = remainingConfirmations;
    }
  }
  return normalized;
}

function validatedJournalFinalStateMatchesCurrent(state, journal, history, mapId) {
  if (journal.length === 0 || history.length !== journal.length) {
    return false;
  }
  for (let index = 0; index < history.length; index += 1) {
    if (!history[index]) return false;
  }
  const finalJournalState = clone(history.at(-1).afterState);
  const confirmations = state.recovery_confirmations ?? [];
  if (confirmations.length === 0) {
    delete finalJournalState.recovery_confirmations;
  } else {
    finalJournalState.recovery_confirmations = clone(confirmations);
  }
  if (state.mutation_receipts === undefined
      || state.mutation_receipts.length === 0) {
    delete finalJournalState.mutation_receipts;
  } else {
    finalJournalState.mutation_receipts = clone(state.mutation_receipts);
  }
  for (const confirmation of confirmations) {
    const matchingEntries = journal.filter((entry) =>
      ['release_claim', 'reclaim_expired_claim'].includes(entry.operation)
        && confirmationMatchesFenceJournal(confirmation, entry, mapId));
    if (matchingEntries.length !== 1) return false;
    const entry = matchingEntries[0];
    const ticket = finalJournalState.tickets.find(({ id }) => id === entry.ticket_id);
    if (!ticket) return false;
    if (ticket.recovery_hold?.code === fenceCode(entry.operation)
        && ticket.recovery_hold.required_at_revision === entry.result.ticket_revision) {
      ticket.recovery_hold = null;
    }
  }
  return isDeepStrictEqual(finalJournalState, state);
}

function stateAtMutationReceiptSequence(state, journal, history, journalSequence) {
  if (!Number.isSafeInteger(journalSequence)
      || journalSequence < 0
      || journalSequence > journal.length) {
    return null;
  }
  if (journalSequence === journal.length) {
    return clone(state);
  }
  return history[journalSequence]?.beforeState
    ? clone(history[journalSequence].beforeState)
    : null;
}

function mutationReceiptMatchesState(receipt, state, mapId) {
  if (receipt.map_id !== mapId) return false;
  const ticket = state.tickets.find(({ id }) => id === receipt.ticket_id);
  if (!ticket || receipt.result.ticket_revision !== ticket.revision) return false;
  switch (receipt.operation) {
    case 'record_task_intent':
      return ticket.parent_map_id === mapId
        && ticket.type === 'task'
        && ticket.task_action?.state === 'intended'
        && receipt.result.idempotency_key === ticket.task_action.idempotency_key;
    case 'record_task_receipt':
      return ticket.parent_map_id === mapId
        && ticket.type === 'task'
        && ticket.task_action?.external_receipt !== undefined
        && receipt.result.idempotency_key
          === ticket.task_action.external_receipt.idempotency_key
        && receipt.result.outcome
          === (ticket.task_action.state === 'succeeded' ? 'succeeded' : 'unknown')
        && ticket.pending_external_action === null;
    default:
      return false;
  }
}

function findReplay(journal, operation, state, mapId, violations, history = []) {
  const entry = journal.find(({ mutation_key: key }) => key === operation.mutation_key);
  const receipt = (state.mutation_receipts ?? []).find(({ mutation_key: key }) =>
    key === operation.mutation_key);
  if (entry && receipt) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  if (!entry && !receipt) return null;
  if (receipt) {
    if (receipt.operation !== operation.operation
        || receipt.ticket_id !== operation.ticket_id
        || receipt.fingerprint_sha256 !== operationFingerprint(operation)) {
      addViolation(violations, 'mutation-key-conflict');
      return { conflict: true };
    }
    if (journal.length > 0
        && !validatedJournalFinalStateMatchesCurrent(state, journal, history, mapId)) {
      addViolation(violations, 'mutation-journal-conflict');
      return { conflict: true };
    }
    const historicalState = stateAtMutationReceiptSequence(
      state,
      journal,
      history,
      receipt.journal_sequence,
    );
    if (!historicalState
        || !mutationReceiptMatchesOperation(receipt, operation, historicalState, mapId)) {
      addViolation(violations, 'mutation-journal-conflict');
      return { conflict: true };
    }
    return { conflict: false, result: clone(receipt.result) };
  }
  const fingerprint = operationFingerprint(operation);
  if (entry.operation !== operation.operation
      || entry.ticket_id !== operation.ticket_id
      || entry.fingerprint_sha256 !== fingerprint) {
    addViolation(violations, 'mutation-key-conflict');
    return { conflict: true };
  }
  if (entry.map_id !== mapId) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  const entryIndex = journal.indexOf(entry);
  const historical = history[entryIndex];
  if (entryIndex < history.length && !historical) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  if (historical
      && !replayResultMatchesState(entry, historical.operation, historical.afterState, mapId)) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  if (operation.operation === 'record_progress'
      && entry.result.no_op === true
      && (entry.before_state_sha256 !== entry.after_state_sha256
        || entry.result.ticket_revision !== operation.expected_revision)) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  if (historical && !validatedJournalFinalStateMatchesCurrent(
    state,
    journal,
    history,
    mapId,
  )) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  const replayState = historical
    ? historical.afterState
    : replayStateForJournal(entry, state, operation, mapId);
  if (!replayState) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  if (!replayResultMatchesState(entry, operation, replayState, mapId)) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  if (historical) {
    if (!replayTimestampMatchesState(
      entry,
      operation,
      historical.afterState,
      historical.beforeState,
    )) {
      addViolation(violations, 'mutation-journal-conflict');
      return { conflict: true };
    }
    return { conflict: false, result: clone(entry.result) };
  }
  const beforeState = restorePreState(replayState, operation, entry.result);
  if (!beforeState
      || entry.before_state_sha256 !== sha256(beforeState)) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  if (!replayTimestampMatchesState(entry, operation, replayState, beforeState)) {
    addViolation(violations, 'mutation-journal-conflict');
    return { conflict: true };
  }
  return { conflict: false, result: clone(entry.result) };
}

function appendJournal(
  journal,
  operation,
  result,
  beforeState,
  afterState,
  mapId,
  committedAt,
  violations,
) {
  if (journal.length >= RECOVERY_LIMITS.journalEntries) {
    addViolation(violations, 'journal-capacity-exceeded');
    return null;
  }
  return [
    ...journal,
    {
      sequence: journal.length + 1,
      previous_entry_sha256: journal.length === 0
        ? JOURNAL_GENESIS
        : sha256(journal.at(-1)),
      mutation_key: operation.mutation_key,
      operation: operation.operation,
      ticket_id: operation.ticket_id,
      fingerprint_sha256: operationFingerprint(operation),
      map_id: mapId,
      before_state_sha256: sha256(beforeState),
      after_state_sha256: sha256(afterState),
      committed_at: committedAt,
      operation_input: clone(operation),
      before_recovery_confirmations: clone(beforeState.recovery_confirmations ?? []),
      after_recovery_confirmations: clone(afterState.recovery_confirmations ?? []),
      result: clone(result),
    },
  ];
}

function authoritativeNoOpTimestamp(operation, result, beforeState) {
  if (!result || result.ticket_revision !== operation.expected_revision) return null;
  switch (operation.operation) {
    case 'record_progress':
      return result.recorded_at ?? null;
    case 'record_task_receipt': {
      const action = beforeState.external_actions.find((candidate) =>
        candidate.ticket_id === operation.ticket_id
          && candidate.idempotency_key === operation.idempotency_key);
      return action?.performed_at ?? null;
    }
    default:
      return null;
  }
}

function mutationReceiptMatchesOperation(receipt, operation, state, mapId) {
  if (receipt.operation !== operation.operation
      || receipt.ticket_id !== operation.ticket_id
      || receipt.map_id !== mapId
      || receipt.mutation_key !== operation.mutation_key
      || receipt.fingerprint_sha256 !== operationFingerprint(operation)) {
    return false;
  }
  const ticket = state.tickets.find(({ id }) => id === operation.ticket_id);
  if (!ticket
      || receipt.result.ticket_revision !== ticket.revision
      || receipt.result.ticket_revision !== operation.expected_revision) {
    return false;
  }
  switch (operation.operation) {
    case 'record_task_intent':
      return ticket.type === 'task'
        && ticket.task_action?.state === 'intended'
        && ticket.task_action.intent === operation.intent
        && ticket.task_action.idempotency_key === operation.idempotency_key
        && ticket.task_action.authorization_reference === operation.authorization_reference
        && ticket.task_action.reconciliation_method === operation.reconciliation_method
        && receipt.result.idempotency_key === operation.idempotency_key;
    case 'record_task_receipt':
      return ticket.type === 'task'
        && ticket.task_action?.external_receipt !== undefined
        && isDeepStrictEqual(ticket.task_action.external_receipt, operation.receipt)
        && ticket.task_action.state
          === (operation.outcome === 'succeeded' ? 'succeeded' : 'outcome_unknown')
        && ticket.pending_external_action === null
        && receipt.result.idempotency_key === operation.idempotency_key
        && receipt.result.outcome === operation.outcome;
    default:
      return false;
  }
}

function appendMutationReceipt(
  state,
  operation,
  result,
  mapId,
  journalLength,
  violations,
) {
  const existing = state.mutation_receipts ?? [];
  if (existing.length >= RECOVERY_LIMITS.mutationReceipts) {
    addViolation(violations, 'mutation-receipt-capacity-exceeded');
    return false;
  }
  state.mutation_receipts = [
    ...existing,
    {
      mutation_key: operation.mutation_key,
      operation: operation.operation,
      ticket_id: operation.ticket_id,
      map_id: mapId,
      journal_sequence: journalLength,
      fingerprint_sha256: operationFingerprint(operation),
      result: clone(result),
    },
  ].sort((left, right) => compareStrings(left.mutation_key, right.mutation_key));
  return true;
}

function isKnownNoOpWithoutAuthority(state, operation) {
  const ticket = state.tickets.find(({ id }) => id === operation.ticket_id);
  if (!ticket || operation.expected_revision !== ticket.revision) return false;
  if (operation.operation === 'record_task_intent') {
    return ticket.type === 'task'
      && ticket.task_action?.state === 'intended'
      && ticket.task_action.intent === operation.intent
      && ticket.task_action.idempotency_key === operation.idempotency_key
      && ticket.task_action.authorization_reference === operation.authorization_reference
      && ticket.task_action.reconciliation_method === operation.reconciliation_method;
  }
  if (operation.operation === 'record_task_receipt') {
    return ticket.type === 'task'
      && ticket.task_action?.external_receipt !== undefined
      && ticket.pending_external_action === null
      && isDeepStrictEqual(ticket.task_action.external_receipt, operation.receipt)
      && !state.external_actions.some((entry) =>
        entry.ticket_id === ticket.id
          && entry.idempotency_key === operation.idempotency_key);
  }
  return false;
}

function mayAppendJournal(state, journal, operation) {
  if (!MUTATION_OPERATIONS.has(operation.operation)) return false;
  if (journal.some(({ mutation_key: key }) => key === operation.mutation_key)
      || (state.mutation_receipts ?? []).some(
        ({ mutation_key: key }) => key === operation.mutation_key,
      )) {
    return false;
  }
  return !isKnownNoOpWithoutAuthority(state, operation);
}

function journalCapacityExceeded(state, journal, operations) {
  const possibleAppends = operations.reduce(
    (count, operation) => count + (mayAppendJournal(state, journal, operation) ? 1 : 0),
    0,
  );
  return journal.length + possibleAppends > RECOVERY_LIMITS.journalEntries;
}

function appendRecoveryConfirmation(
  state,
  mapId,
  ticket,
  fenceKind,
  readResult,
  violations,
) {
  const confirmation = {
    map_id: mapId,
    ticket_id: ticket.id,
    revision: ticket.revision,
    fence_kind: fenceKind,
    read_result: clone(readResult),
  };
  const existing = state.recovery_confirmations ?? [];
  const matching = existing.filter((entry) =>
    entry.map_id === confirmation.map_id
      && entry.ticket_id === confirmation.ticket_id
      && entry.revision === confirmation.revision
      && entry.fence_kind === confirmation.fence_kind);
  if (matching.length > 1
      || (matching.length === 1 && !isDeepStrictEqual(matching[0], confirmation))) {
    addViolation(violations, 'recovery-confirmation-conflict');
    return false;
  }
  if (matching.length === 1) return true;
  if (existing.length >= RECOVERY_LIMITS.recoveryConfirmations) {
    addViolation(violations, 'recovery-confirmation-capacity-exhausted');
    return false;
  }
  state.recovery_confirmations = [...existing, confirmation].sort(
    compareRecoveryConfirmations,
  );
  return true;
}

function applyGetTicket(state, ticket, operation, mapId, context, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (operation.full !== true) {
    addViolation(violations, 'full-inspection-required');
    return null;
  }
  const reclaimConfirmationRequired =
    context.inspectionRequiredAtRevision === ticket.revision;
  const releaseConfirmationRequired =
    context.releaseConfirmationRequiredAtRevision === ticket.revision;
  if (reclaimConfirmationRequired && releaseConfirmationRequired) {
    addViolation(violations, 'recovery-confirmation-conflict');
    return null;
  }
  if (releaseConfirmationRequired && ticket.claim !== null) {
    addViolation(violations, 'release-confirmation-claim-present');
    return null;
  }
  const fenceKind = reclaimConfirmationRequired
    ? 'reclaim-inspection-required'
    : releaseConfirmationRequired
      ? 'release-confirmation-required'
      : null;
  if (fenceKind
      && !appendRecoveryConfirmation(
        state,
        mapId,
        ticket,
        fenceKind,
        {
          ticket_revision: ticket.revision,
          full: true,
          claim_absent: ticket.claim === null,
        },
        violations,
      )) {
    return null;
  }
  context.lastFullInspectionRevision = ticket.revision;
  if (reclaimConfirmationRequired) {
    context.inspectionRequiredAtRevision = null;
    if (ticket.recovery_hold?.code === 'reclaim-inspection-required'
        && ticket.recovery_hold.required_at_revision === ticket.revision) {
      ticket.recovery_hold = null;
    }
  }
  if (releaseConfirmationRequired) {
    context.releaseConfirmationRequiredAtRevision = null;
    context.lastReleaseConfirmationRevision = ticket.revision;
    if (ticket.recovery_hold?.code === 'release-confirmation-required'
        && ticket.recovery_hold.required_at_revision === ticket.revision) {
      ticket.recovery_hold = null;
    }
  }
  return {
    ticket_revision: ticket.revision,
    full: true,
    claim_absent: ticket.claim === null,
  };
}

function applyRecordProgress(ticket, operation, now, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (!activeClaimMatches(ticket, operation, now, violations)) return null;
  const progressKey = stableIdentity(
    operation.progress_key,
    'record_progress.progress_key',
  );
  if (!isRecord(operation.payload)) fail('record_progress.payload must be an object.');
  const payload = normalizeBoundedJson(
    operation.payload,
    'record_progress.payload',
    RECOVERY_LIMITS.payloadBytes,
  );
  const existing = ticket.progress_records.find((entry) =>
    entry.progress_key === progressKey);
  if (existing) {
    if (!isDeepStrictEqual(existing.payload, payload)) {
      addViolation(violations, 'progress-key-conflict');
      return null;
    }
    return {
      ticket_revision: ticket.revision,
      progress_key: progressKey,
      record_revision: existing.revision,
      recorded_at: existing.recorded_at,
      no_op: true,
    };
  }
  const previous = ticket.progress_records.at(-1);
  if (previous && Date.parse(previous.recorded_at) > Date.parse(now)) {
    addViolation(violations, 'progress-history-conflict');
    return null;
  }
  if (ticket.progress_records.length >= RECOVERY_LIMITS.progressPerTicket) {
    addViolation(violations, 'progress-capacity-exhausted');
    return null;
  }
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  ticket.revision = revision;
  ticket.progress_records.push({
    progress_key: progressKey,
    payload,
    recorded_at: now,
    revision,
  });
  return {
    ticket_revision: revision,
    progress_key: progressKey,
    record_revision: revision,
  };
}

function applyRecordTaskIntent(ticket, operation, now, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (!activeClaimMatches(ticket, operation, now, violations)) return null;
  if (ticket.type !== 'task') {
    addViolation(violations, 'task-operation-on-non-task');
    return null;
  }
  const intended = {
    intent: requiredString(operation.intent, 'record_task_intent.intent'),
    idempotency_key: stableIdentity(
      operation.idempotency_key,
      'record_task_intent.idempotency_key',
    ),
    authorization_reference: stableIdentity(
      operation.authorization_reference,
      'record_task_intent.authorization_reference',
    ),
    reconciliation_method: requiredString(
      operation.reconciliation_method,
      'record_task_intent.reconciliation_method',
    ),
    state: 'intended',
  };
  if (ticket.task_action) {
    if (!isDeepStrictEqual(ticket.task_action, intended)) {
      addViolation(violations, 'task-intent-conflict');
      return null;
    }
    return {
      ticket_revision: ticket.revision,
      idempotency_key: intended.idempotency_key,
    };
  }
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  ticket.task_action = intended;
  ticket.revision = revision;
  return {
    ticket_revision: revision,
    idempotency_key: intended.idempotency_key,
  };
}

function applyExternalAction(state, ticket, operation, now, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (!activeClaimMatches(ticket, operation, now, violations)) return null;
  if (ticket.type !== 'task') {
    addViolation(violations, 'task-operation-on-non-task');
    return null;
  }
  const key = stableIdentity(operation.idempotency_key, 'external_action.idempotency_key');
  const receiptKey = ticket.task_action?.external_receipt?.idempotency_key;
  if (receiptKey) {
    addViolation(
      violations,
      receiptKey === key ? 'duplicate-external-action' : 'new-action-key-after-receipt',
    );
    return null;
  }
  if (!ticket.task_action || ticket.task_action.idempotency_key !== key) {
    addViolation(violations, 'external-action-without-intent');
    return null;
  }
  if (!TASK_OUTCOMES.has(operation.outcome)) {
    addViolation(violations, 'invalid-task-outcome');
    return null;
  }
  if (state.external_actions.some((entry) =>
    entry.ticket_id === ticket.id && entry.idempotency_key === key)) {
    addViolation(violations, 'duplicate-external-action');
    return null;
  }
  if (state.external_actions.length >= RECOVERY_LIMITS.externalActions) {
    addViolation(violations, 'external-action-capacity-exhausted');
    return null;
  }
  const externalSystem = stableIdentity(
    operation.external_system,
    'external_action.external_system',
  );
  const lookupReference = stableIdentity(
    operation.lookup_reference,
    'external_action.lookup_reference',
  );
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  state.external_actions = [
    ...state.external_actions,
    {
      ticket_id: ticket.id,
      idempotency_key: key,
      external_system: externalSystem,
      lookup_reference: lookupReference,
      outcome: operation.outcome,
      performed_at: now,
    },
  ];
  ticket.pending_external_action = {
    ticket_id: ticket.id,
    intent: ticket.task_action.intent,
    idempotency_key: key,
    claim_token: ticket.claim.claim_token,
    owner_id: ticket.claim.owner_id,
    session_id: ticket.claim.session_id,
    external_system: externalSystem,
    lookup_reference: lookupReference,
    outcome: operation.outcome,
    performed_at: now,
    receipt_synchronization_pending: true,
  };
  ticket.revision = revision;
  return {
    ticket_revision: revision,
    idempotency_key: key,
    external_action_count: state.external_actions.length,
  };
}

function applyRecordTaskReceipt(ticket, operation, now, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (!activeClaimMatches(ticket, operation, now, violations)) return null;
  if (ticket.type !== 'task') {
    addViolation(violations, 'task-operation-on-non-task');
    return null;
  }
  if (!ticket.task_action) {
    addViolation(violations, 'task-receipt-without-intent');
    return null;
  }
  const key = stableIdentity(
    operation.idempotency_key,
    'record_task_receipt.idempotency_key',
  );
  if (key !== ticket.task_action.idempotency_key) {
    addViolation(violations, 'task-action-key-conflict');
    return null;
  }
  if (!TASK_OUTCOMES.has(operation.outcome)) {
    addViolation(violations, 'invalid-task-outcome');
    return null;
  }
  const receipt = normalizeReceipt(operation.receipt, 'record_task_receipt.receipt');
  if (receipt.idempotency_key !== key) {
    addViolation(violations, 'task-action-key-conflict');
    return null;
  }
  if (receipt.result !== operation.outcome) {
    addViolation(violations, 'task-receipt-conflict');
    return null;
  }
  const pending = ticket.pending_external_action;
  if (pending
      && (pending.idempotency_key !== key
        || pending.claim_token !== operation.claim_token
        || pending.owner_id !== operation.owner_id
        || pending.session_id !== operation.session_id
        || pending.external_system !== receipt.external_system
        || pending.lookup_reference !== receipt.lookup_reference
        || pending.outcome !== operation.outcome)) {
    addViolation(violations, 'task-receipt-conflict');
    return null;
  }
  const nextState = operation.outcome === 'unknown'
    ? 'outcome_unknown'
    : 'succeeded';
  if (ticket.task_action.external_receipt) {
    if (ticket.task_action.state === nextState
        && isDeepStrictEqual(ticket.task_action.external_receipt, receipt)) {
      return {
        ticket_revision: ticket.revision,
        idempotency_key: key,
        outcome: operation.outcome,
      };
    }
    addViolation(violations, 'task-receipt-conflict');
    return null;
  }
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  ticket.task_action.external_receipt = receipt;
  ticket.task_action.state = nextState;
  ticket.pending_external_action = null;
  ticket.revision = revision;
  setUnknownOutcomeHold(ticket);
  return {
    ticket_revision: revision,
    idempotency_key: key,
    outcome: operation.outcome,
  };
}

function applyBlockTicket(ticket, operation, now, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (!activeClaimMatches(ticket, operation, now, violations)) return null;
  if (operation.confirmed !== true) {
    addViolation(violations, 'block-unconfirmed');
    return null;
  }
  if (ticket.block_history.length >= RECOVERY_LIMITS.blockHistoryPerTicket) {
    addViolation(violations, 'block-history-capacity-exhausted');
    return null;
  }
  const reason = requiredString(operation.reason, 'block_ticket.reason');
  const evidenceReference = stableIdentity(
    operation.evidence_reference,
    'block_ticket.evidence_reference',
  );
  const actorId = stableIdentity(operation.actor_id, 'block_ticket.actor_id');
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  const block = {
    reason,
    evidence_reference: evidenceReference,
    actor_id: actorId,
    blocked_at: now,
    blocked_revision: revision,
    requires_human_resolution: true,
  };
  ticket.status = 'blocked';
  ticket.block = block;
  ticket.block_history.push(block);
  ticket.recovery_hold = null;
  ticket.revision = revision;
  return {
    ticket_revision: revision,
    blocked_revision: revision,
  };
}

function applyReleaseClaim(ticket, operation, now, context, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (!activeClaimMatches(ticket, operation, now, violations)) return null;
  if (unknownOutcome(ticket)
      && (ticket.status !== 'blocked'
        || ticket.block?.requires_human_resolution !== true
        || context.lastFullInspectionRevision !== ticket.revision)) {
    addViolation(violations, 'release-before-confirmed-block');
    return null;
  }
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  ticket.claim = null;
  ticket.revision = revision;
  ticket.recovery_hold = {
    code: 'release-confirmation-required',
    required_at_revision: revision,
  };
  context.releaseConfirmationRequiredAtRevision = revision;
  context.lastReleaseConfirmationRevision = null;
  return {
    ticket_revision: revision,
    claim_absent: true,
  };
}

function applyUnblockTicket(ticket, operation, now, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (!Number.isSafeInteger(operation.block_revision)
      || operation.block_revision !== ticket.block.blocked_revision) {
    addViolation(violations, 'block-revision-conflict');
    return null;
  }
  if (operation.actor_type !== 'human') {
    addViolation(violations, 'human-required-for-unblock');
    return null;
  }
  if (!isMeaningfulString(operation.actor_id)
      || !isMeaningfulString(operation.authorization_reference)) {
    addViolation(violations, 'human-authorization-required');
    return null;
  }
  const actorId = stableIdentity(operation.actor_id, 'unblock_ticket.actor_id');
  const authorizationReference = stableIdentity(
    operation.authorization_reference,
    'unblock_ticket.authorization_reference',
  );
  const reconciliationEvidence = normalizeReconciliationEvidence(
    operation.reconciliation_evidence,
  );
  if (!reconciliationEvidence) {
    addViolation(violations, 'authoritative-reconciliation-required');
    return null;
  }
  let reconciledTaskAction = null;
  if (unknownOutcome(ticket)) {
    const resolution = reconciliationEvidence.task_action;
    if (!resolution
        || resolution.state !== 'succeeded'
        || resolution.receipt.result !== 'succeeded') {
      addViolation(violations, 'unresolved-external-outcome');
      return null;
    }
    if (resolution.receipt.idempotency_key !== ticket.task_action.idempotency_key) {
      addViolation(violations, 'task-action-key-conflict');
      return null;
    }
    if (ticket.task_action.external_receipt
        && resolution.receipt.external_system
          !== ticket.task_action.external_receipt.external_system) {
      addViolation(violations, 'task-receipt-conflict');
      return null;
    }
    reconciledTaskAction = resolution.receipt;
  }
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  if (reconciledTaskAction) {
    ticket.task_action.state = 'succeeded';
    ticket.task_action.external_receipt = reconciledTaskAction;
  }
  const reconciliation = {
    block_revision: operation.block_revision,
    actor_type: 'human',
    actor_id: actorId,
    authorization_reference: authorizationReference,
    reconciliation_evidence: reconciliationEvidence,
    reconciled_at: now,
    resulting_revision: revision,
  };
  ticket.block_history = ticket.block_history.map((historicalBlock) =>
    historicalBlock.blocked_revision === operation.block_revision
      ? { ...historicalBlock, reconciliation }
      : historicalBlock);
  ticket.status = 'open';
  ticket.block = null;
  ticket.recovery_hold = null;
  ticket.revision = revision;
  return {
    ticket_revision: revision,
    block_revision: operation.block_revision,
  };
}

function computedExpiry(now, duration) {
  if (!Number.isSafeInteger(duration)
      || duration < 1
      || duration > MAX_LEASE_DURATION_MS) {
    fail(
      `reclaim_expired_claim.lease_duration_ms must be a positive safe integer no greater than ${MAX_LEASE_DURATION_MS}.`,
    );
  }
  const expiryMilliseconds = Date.parse(now) + duration;
  if (!Number.isFinite(expiryMilliseconds)) {
    fail('reclaim_expired_claim computed expiry must be an RFC 3339 timestamp.');
  }
  const expiresAt = new Date(expiryMilliseconds).toISOString();
  if (!/^\d{4}-/.test(expiresAt)) {
    fail('reclaim_expired_claim computed expiry must be an RFC 3339 timestamp.');
  }
  return expiresAt;
}

function applyReclaimExpiredClaim(ticket, operation, now, context, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  const currentClaim = ticket.claim;
  if (!currentClaim
      || currentClaim.claim_token !== operation.observed_claim_token
      || Date.parse(now) < Date.parse(currentClaim.expires_at)) {
    addViolation(violations, 'claim-not-reclaimable');
    return null;
  }
  const expiresAt = computedExpiry(now, operation.lease_duration_ms);
  const newClaimToken = stableIdentity(
    operation.new_claim_token,
    'reclaim_expired_claim.new_claim_token',
  );
  const ownerId = stableIdentity(
    operation.owner_id,
    'reclaim_expired_claim.owner_id',
  );
  const sessionId = stableIdentity(
    operation.session_id,
    'reclaim_expired_claim.session_id',
  );
  if (newClaimToken === currentClaim.claim_token) {
    addViolation(violations, 'reclaim-token-not-fresh');
    return null;
  }
  if (sessionId === currentClaim.session_id) {
    addViolation(violations, 'reclaim-session-not-fresh');
    return null;
  }
  const revision = nextRevision(ticket, violations);
  if (revision === null) return null;
  ticket.claim = {
    claim_token: newClaimToken,
    owner_id: ownerId,
    session_id: sessionId,
    acquired_at: now,
    expires_at: expiresAt,
  };
  if (ticket.pending_external_action) {
    ticket.pending_external_action = {
      ...ticket.pending_external_action,
      claim_token: newClaimToken,
      owner_id: ownerId,
      session_id: sessionId,
    };
  }
  ticket.revision = revision;
  ticket.recovery_hold = {
    code: 'reclaim-inspection-required',
    required_at_revision: revision,
  };
  context.inspectionRequiredAtRevision = revision;
  context.lastFullInspectionRevision = null;
  return {
    ticket_revision: revision,
    claim_token: newClaimToken,
    expires_at: expiresAt,
  };
}

function defaultContext() {
  return {
    inspectionRequiredAtRevision: null,
    lastFullInspectionRevision: null,
    releaseConfirmationRequiredAtRevision: null,
    lastReleaseConfirmationRevision: null,
  };
}

function candidateFor(state, index) {
  const tickets = [...state.tickets];
  const ticket = clone(tickets[index]);
  tickets[index] = ticket;
  const candidateState = {
    tickets,
    external_actions: state.external_actions,
  };
  if (state.recovery_confirmations !== undefined) {
    candidateState.recovery_confirmations = state.recovery_confirmations;
  }
  if (state.mutation_receipts !== undefined) {
    candidateState.mutation_receipts = state.mutation_receipts;
  }
  return {
    state: candidateState,
    ticket,
  };
}

function applyOperation(
  state,
  operation,
  now,
  mapId,
  contexts,
  journal,
  recoveryInvalid,
  journalHistory,
) {
  const violations = [];
  const scoped = scopedTicket(state, operation, mapId, violations);
  if (!scoped) {
    return {
      state,
      contexts,
      journal,
      violations,
      replayed: false,
      mutationResult: null,
      readResult: null,
    };
  }
  const existingContext = contexts.get(operation.ticket_id) ?? defaultContext();
  if (MUTATION_OPERATIONS.has(operation.operation)) {
    const replay = findReplay(
      journal,
      operation,
      state,
      mapId,
      violations,
      journalHistory,
    );
    if (replay) {
      if (recoveryInvalid && !replay.conflict) {
        addViolation(violations, 'mutation-journal-conflict');
        return {
          state,
          contexts,
          journal,
          violations,
          replayed: false,
          mutationResult: null,
          readResult: null,
        };
      }
      let replayContexts = contexts;
      if (!replay.conflict) {
        const replayContext = clone(existingContext);
        const replayRevision = replay.result.ticket_revision;
        if (operation.operation === 'release_claim'
            && replayContext.lastReleaseConfirmationRevision !== replayRevision) {
          replayContext.releaseConfirmationRequiredAtRevision = replayRevision;
        }
        if (operation.operation === 'reclaim_expired_claim'
            && replayContext.lastFullInspectionRevision !== replayRevision) {
          replayContext.inspectionRequiredAtRevision = replayRevision;
        }
        replayContexts = new Map(contexts);
        replayContexts.set(operation.ticket_id, replayContext);
      }
      return {
        state,
        contexts: replayContexts,
        journal,
        violations,
        replayed: !replay.conflict,
        mutationResult: replay.conflict ? null : replay.result,
        readResult: null,
      };
    }
  }
  if (recoveryInvalid) {
    addViolation(violations, 'mutation-journal-conflict');
    return {
      state,
      contexts,
      journal,
      violations,
      replayed: false,
      mutationResult: null,
      readResult: null,
    };
  }
  if (MUTATION_OPERATIONS.has(operation.operation)
      && [...contexts.values()].some((context) =>
        context.releaseConfirmationRequiredAtRevision !== null)) {
    addViolation(violations, 'work-before-release-confirmation');
    return {
      state,
      contexts,
      journal,
      violations,
      replayed: false,
      mutationResult: null,
      readResult: null,
    };
  }
  if (MUTATION_OPERATIONS.has(operation.operation)
      && [...contexts.values()].some((context) =>
        context.inspectionRequiredAtRevision !== null)) {
    addViolation(violations, 'work-before-full-inspection');
    return {
      state,
      contexts,
      journal,
      violations,
      replayed: false,
      mutationResult: null,
      readResult: null,
    };
  }
  if (scoped.ticket.pending_external_action
      && !['get_ticket', 'record_task_receipt', 'reclaim_expired_claim']
        .includes(operation.operation)) {
    addViolation(violations, 'pending-external-action');
    return {
      state,
      contexts,
      journal,
      violations,
      replayed: false,
      mutationResult: null,
      readResult: null,
    };
  }
  if (!lifecycleAllows(scoped.ticket, operation, violations)) {
    return {
      state,
      contexts,
      journal,
      violations,
      replayed: false,
      mutationResult: null,
      readResult: null,
    };
  }
  const candidate = candidateFor(state, scoped.index);
  const candidateContexts = new Map(contexts);
  const context = clone(existingContext);
  candidateContexts.set(operation.ticket_id, context);
  let mutationResult = null;
  let readResult = null;
  switch (operation.operation) {
    case 'get_ticket':
      readResult = applyGetTicket(
        candidate.state,
        candidate.ticket,
        operation,
        mapId,
        context,
        violations,
      );
      break;
    case 'record_progress':
      mutationResult = applyRecordProgress(candidate.ticket, operation, now, violations);
      break;
    case 'record_task_intent':
      mutationResult = applyRecordTaskIntent(candidate.ticket, operation, now, violations);
      break;
    case 'external_action':
      mutationResult = applyExternalAction(
        candidate.state,
        candidate.ticket,
        operation,
        now,
        violations,
      );
      break;
    case 'record_task_receipt':
      mutationResult = applyRecordTaskReceipt(
        candidate.ticket,
        operation,
        now,
        violations,
      );
      break;
    case 'block_ticket':
      mutationResult = applyBlockTicket(candidate.ticket, operation, now, violations);
      break;
    case 'release_claim':
      mutationResult = applyReleaseClaim(
        candidate.ticket,
        operation,
        now,
        context,
        violations,
      );
      break;
    case 'unblock_ticket':
      mutationResult = applyUnblockTicket(
        candidate.ticket,
        operation,
        now,
        violations,
      );
      break;
    case 'reclaim_expired_claim':
      mutationResult = applyReclaimExpiredClaim(
        candidate.ticket,
        operation,
        now,
        context,
        violations,
      );
      break;
    default:
      fail(`unknown operation ${operation.operation}.`);
  }
  if (violations.length > 0) {
    return {
      state,
      contexts,
      journal,
      violations,
      replayed: false,
      mutationResult: null,
      readResult: null,
    };
  }
  let nextJournal = journal;
  let nextJournalHistory = journalHistory;
  if (MUTATION_OPERATIONS.has(operation.operation)) {
    mutationResult = journalResult(operation, mutationResult, state, now);
    const noOp = mutationResult.ticket_revision === operation.expected_revision;
    const authoritativeAt = authoritativeNoOpTimestamp(operation, mutationResult, state);
    const committedAt = noOp ? authoritativeAt : now;
    const shouldJournal = !noOp || authoritativeAt !== null;
    if (shouldJournal) {
      nextJournal = appendJournal(
        journal,
        operation,
        mutationResult,
        state,
        candidate.state,
        mapId,
        committedAt,
        violations,
      );
      if (violations.length > 0 || nextJournal === null) {
        return {
          state,
          contexts,
          journal,
          violations,
          replayed: false,
          mutationResult: null,
          readResult: null,
        };
      }
      nextJournalHistory = [
        ...journalHistory,
        {
          entry: clone(nextJournal.at(-1)),
          operation: clone(operation),
          beforeState: clone(state),
          afterState: clone(candidate.state),
        },
      ];
    } else if (!appendMutationReceipt(
      candidate.state,
      operation,
      mutationResult,
      mapId,
      journal.length,
      violations,
    )) {
      return {
        state,
        contexts,
        journal,
        violations,
        replayed: false,
        mutationResult: null,
        readResult: null,
      };
    }
  }
  return {
    state: candidate.state,
    contexts: candidateContexts,
    journal: nextJournal,
    journalHistory: nextJournalHistory,
    violations,
    replayed: false,
    mutationResult,
    readResult,
  };
}

function stateDeltas(before, after, ticketId) {
  const deltas = [];
  const beforeTicket = before.tickets.find(({ id }) => id === ticketId);
  const afterTicket = after.tickets.find(({ id }) => id === ticketId);
  if (!isDeepStrictEqual(beforeTicket, afterTicket)) {
    deltas.push({
      path: `/tickets/${ticketId.replaceAll('~', '~0').replaceAll('/', '~1')}`,
      beforeSha256: sha256(beforeTicket),
      afterSha256: sha256(afterTicket),
    });
  }
  if (!isDeepStrictEqual(before.external_actions, after.external_actions)) {
    deltas.push({
      path: '/external_actions',
      beforeSha256: sha256(before.external_actions),
      afterSha256: sha256(after.external_actions),
    });
  }
  if (!isDeepStrictEqual(
    before.recovery_confirmations ?? [],
    after.recovery_confirmations ?? [],
  )) {
    deltas.push({
      path: '/recovery_confirmations',
      beforeSha256: sha256(before.recovery_confirmations ?? []),
      afterSha256: sha256(after.recovery_confirmations ?? []),
    });
  }
  if (!isDeepStrictEqual(
    before.mutation_receipts ?? [],
    after.mutation_receipts ?? [],
  )) {
    deltas.push({
      path: '/mutation_receipts',
      beforeSha256: sha256(before.mutation_receipts ?? []),
      afterSha256: sha256(after.mutation_receipts ?? []),
    });
  }
  return deltas;
}

function frontier(state, mapId) {
  const byId = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  return state.tickets
    .filter((ticket) =>
      ticket.parent_map_id === mapId
      && ticket.status === 'open'
      && ticket.claim === null
      && ticket.recovery_hold === null
      && ticket.pending_external_action === null
      && !unknownOutcome(ticket)
      && ticket.blocker_ids.every((id) => byId.get(id)?.status === 'closed'))
    .map(({ id }) => id)
    .sort(compareStrings);
}

function contextFromRecoveryHold(ticket) {
  const context = defaultContext();
  if (ticket.recovery_hold?.code === 'reclaim-inspection-required') {
    context.inspectionRequiredAtRevision = ticket.recovery_hold.required_at_revision;
  }
  if (ticket.recovery_hold?.code === 'release-confirmation-required') {
    context.releaseConfirmationRequiredAtRevision =
      ticket.recovery_hold.required_at_revision;
  }
  return context;
}

function fenceCode(operation) {
  return operation === 'reclaim_expired_claim'
    ? 'reclaim-inspection-required'
    : 'release-confirmation-required';
}

function stateWithFence(state, ticketId, operation, revision) {
  const fenced = clone(state);
  const ticket = fenced.tickets.find(({ id }) => id === ticketId);
  if (!ticket) return null;
  ticket.recovery_hold = {
    code: fenceCode(operation),
    required_at_revision: revision,
  };
  return fenced;
}

function fenceOperationFromJournal(entry, ticket) {
  const result = entry.result;
  if (!result.previous_claim
      || result.ticket_revision < 2) {
    return null;
  }
  const expectedRevision = result.ticket_revision - 1;
  if (entry.operation === 'release_claim') {
    return {
      operation: 'release_claim',
      mutation_key: entry.mutation_key,
      ticket_id: entry.ticket_id,
      expected_revision: expectedRevision,
      claim_token: result.previous_claim.claim_token,
      owner_id: result.previous_claim.owner_id,
      session_id: result.previous_claim.session_id,
    };
  }
  if (entry.operation === 'reclaim_expired_claim') {
    const duration = Date.parse(result.expires_at) - Date.parse(entry.committed_at);
    if (!Number.isSafeInteger(duration)
        || duration < 1
        || duration > MAX_LEASE_DURATION_MS
        || !ticket.claim) {
      return null;
    }
    return {
      operation: 'reclaim_expired_claim',
      mutation_key: entry.mutation_key,
      ticket_id: entry.ticket_id,
      expected_revision: expectedRevision,
      observed_claim_token: result.previous_claim.claim_token,
      new_claim_token: result.claim_token,
      owner_id: ticket.claim.owner_id,
      session_id: ticket.claim.session_id,
      lease_duration_ms: duration,
    };
  }
  return null;
}

function validateFenceJournalEntry(entry, state, ticket, mapId, stateSha256) {
  if (!['release_claim', 'reclaim_expired_claim'].includes(entry.operation)
      || entry.result.ticket_revision !== ticket.revision) {
    return null;
  }
  const operation = fenceOperationFromJournal(entry, ticket);
  if (!operation
      || entry.map_id !== mapId
      || entry.ticket_id !== ticket.id
      || entry.fingerprint_sha256 !== operationFingerprint(operation)) {
    return null;
  }
  const boundPostState = stateWithFence(
    state,
    ticket.id,
    operation.operation,
    entry.result.ticket_revision,
  );
  if (!boundPostState
      || (entry.after_state_sha256 !== stateSha256
        && entry.after_state_sha256 !== sha256(boundPostState))) {
    return null;
  }
  if (!replayResultMatchesState(entry, operation, state, mapId)) return null;
  const beforeState = restorePreState(state, operation, entry.result);
  if (!beforeState
      || entry.before_state_sha256 !== sha256(beforeState)
      || !replayTimestampMatchesState(entry, operation, state, beforeState)) {
    return null;
  }
  const beforeTicket = beforeState.tickets.find(({ id }) => id === ticket.id);
  const expectedInspectionRevision = unknownOutcome(beforeTicket)
    ? beforeTicket.revision
    : null;
  if ((entry.operation === 'release_claim'
      && (Object.hasOwn(entry.result, 'inspection_revision')
        !== (expectedInspectionRevision !== null)))
      || (expectedInspectionRevision !== null
        && entry.result.inspection_revision !== expectedInspectionRevision)) {
    return null;
  }
  return {
    code: fenceCode(operation.operation),
    required_at_revision: entry.result.ticket_revision,
  };
}

function stateWithoutRecoveryConfirmations(state) {
  const durableState = clone(state);
  delete durableState.recovery_confirmations;
  return durableState;
}

function stateWithRecoveryConfirmations(state, confirmations) {
  const restored = clone(state);
  if (confirmations.length === 0) {
    delete restored.recovery_confirmations;
  } else {
    restored.recovery_confirmations = clone(confirmations);
  }
  return restored;
}

function stateWithMutationReceiptsAtJournalIndex(state, journalIndex) {
  const restored = clone(state);
  const receipts = (state.mutation_receipts ?? [])
    .filter(({ journal_sequence: sequence }) => sequence <= journalIndex);
  if (receipts.length === 0) {
    delete restored.mutation_receipts;
  } else {
    restored.mutation_receipts = receipts;
  }
  return restored;
}

function confirmationIdentity(confirmation) {
  return [
    confirmation.map_id,
    confirmation.ticket_id,
    confirmation.revision,
    confirmation.fence_kind,
  ].join('\u0000');
}

function confirmationSetContains(confirmations, confirmation) {
  return confirmations.some((candidate) => isDeepStrictEqual(candidate, confirmation));
}

function confirmationSetSubset(subset, superset) {
  return subset.every((confirmation) => confirmationSetContains(superset, confirmation));
}

function confirmationMatchesFenceJournal(confirmation, entry, mapId) {
  const expectedClaimAbsent = entry.operation === 'release_claim';
  return entry.map_id === mapId
    && confirmation.map_id === entry.map_id
    && confirmation.ticket_id === entry.ticket_id
    && confirmation.revision === entry.result.ticket_revision
    && confirmation.fence_kind === fenceCode(entry.operation)
    && isDeepStrictEqual(confirmation.read_result, {
      ticket_revision: entry.result.ticket_revision,
      full: true,
      claim_absent: expectedClaimAbsent,
    });
}

function journalOperation(entry, postState) {
  return entry.operation_input === undefined || entry.operation_input === null
    ? null
    : clone(entry.operation_input);
}

function historicalConfirmationSnapshots(state, mapId, journal, confirmations, violations) {
  const matchingIndexes = new Map();
  const seen = new Set();
  for (const confirmation of confirmations) {
    const identity = confirmationIdentity(confirmation);
    if (seen.has(identity)) {
      addViolation(violations, 'mutation-journal-conflict');
      continue;
    }
    seen.add(identity);
    const ticket = state.tickets.find(({ id }) => id === confirmation.ticket_id);
    if (!ticket
        || ticket.parent_map_id !== mapId
        || confirmation.map_id !== mapId
        || confirmation.revision > ticket.revision) {
      addViolation(violations, 'mutation-journal-conflict');
      continue;
    }
    const entries = journal
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        ['release_claim', 'reclaim_expired_claim'].includes(entry.operation)
          && confirmationMatchesFenceJournal(confirmation, entry, mapId));
    if (entries.length !== 1) {
      addViolation(violations, 'mutation-journal-conflict');
      continue;
    }
    matchingIndexes.set(identity, entries[0].index);
  }

  const snapshots = journal.map((entry, index) => {
    const fallback = confirmations.filter((confirmation) => {
      const confirmationIndex = matchingIndexes.get(confirmationIdentity(confirmation));
      return confirmationIndex !== undefined && confirmationIndex < index;
    });
    const before = entry.before_recovery_confirmations ?? fallback;
    const after = entry.after_recovery_confirmations ?? fallback;
    for (const entries of [before, after]) {
      const snapshotIdentities = new Set();
      for (const confirmation of entries) {
        const identity = confirmationIdentity(confirmation);
        if (snapshotIdentities.has(identity)) {
          addViolation(violations, 'mutation-journal-conflict');
        }
        snapshotIdentities.add(identity);
      }
    }
    if (!isDeepStrictEqual(before, fallback)
        || !isDeepStrictEqual(after, fallback)
        || !isDeepStrictEqual(before, after)
        || !confirmationSetSubset(before, confirmations)
        || !confirmationSetSubset(after, confirmations)) {
      addViolation(violations, 'mutation-journal-conflict');
    }
    for (const confirmation of [...before, ...after]) {
      const confirmationIndex = matchingIndexes.get(confirmationIdentity(confirmation));
      if (confirmationIndex === undefined || confirmationIndex >= index) {
        addViolation(violations, 'mutation-journal-conflict');
      }
    }
    return {
      before: [...before].sort(compareRecoveryConfirmations),
      after: [...after].sort(compareRecoveryConfirmations),
    };
  });

  for (let index = 1; index < snapshots.length; index += 1) {
    if (!confirmationSetSubset(
      snapshots[index - 1].after,
      snapshots[index].before,
    )) {
      addViolation(violations, 'mutation-journal-conflict');
    }
  }
  for (const [identity, entryIndex] of matchingIndexes.entries()) {
    const nextIndex = entryIndex + 1;
    if (nextIndex < snapshots.length
        && !snapshots[nextIndex].before.some(
          (confirmation) => confirmationIdentity(confirmation) === identity,
        )) {
      addViolation(violations, 'mutation-journal-conflict');
    }
  }
  return snapshots;
}

function reconstructJournalHistory(state, mapId, journal, violations) {
  const confirmations = state.recovery_confirmations ?? [];
  const snapshots = historicalConfirmationSnapshots(
    state,
    mapId,
    journal,
    confirmations,
    violations,
  );
  const history = Array(journal.length);
  let working = clone(state);

  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index];
    const snapshot = snapshots[index];
    working = stateWithMutationReceiptsAtJournalIndex(working, index);
    const postWithConfirmations = stateWithRecoveryConfirmations(
      working,
      snapshot.after,
    );
    const operation = journalOperation(entry, postWithConfirmations);
    const fingerprintValid = entry.fingerprint_sha256
      === operationFingerprint(operation ?? {});
    if (!operation
        || entry.map_id !== mapId
        || entry.operation !== operation.operation
        || entry.mutation_key !== operation.mutation_key
        || entry.ticket_id !== operation.ticket_id
        || !fingerprintValid) {
      addViolation(violations, 'mutation-journal-conflict');
      continue;
    }

    let afterState = postWithConfirmations;
    if (['release_claim', 'reclaim_expired_claim'].includes(entry.operation)) {
      const fenced = stateWithFence(
        postWithConfirmations,
        entry.ticket_id,
        entry.operation,
        entry.result.ticket_revision,
      );
      if (!fenced || entry.after_state_sha256 !== sha256(fenced)) {
        addViolation(violations, 'mutation-journal-conflict');
        continue;
      }
      afterState = fenced;
    }
    if (entry.after_state_sha256 !== sha256(afterState)
        || !replayResultMatchesState(entry, operation, afterState, mapId)) {
      addViolation(violations, 'mutation-journal-conflict');
      continue;
    }

    const beforeWithoutConfirmations = restorePreState(
      afterState,
      operation,
      entry.result,
    );
    if (!beforeWithoutConfirmations) {
      addViolation(violations, 'mutation-journal-conflict');
      continue;
    }
    const beforeState = stateWithRecoveryConfirmations(
      beforeWithoutConfirmations,
      snapshot.before,
    );
    if (entry.before_state_sha256 !== sha256(beforeState)
        || !replayTimestampMatchesState(entry, operation, afterState, beforeState)) {
      addViolation(violations, 'mutation-journal-conflict');
      continue;
    }
    history[index] = { entry, operation, beforeState, afterState };
    working = beforeState;
  }
  return history;
}

function validateMutationReceipts(state, mapId, journal, history, violations) {
  const receipts = state.mutation_receipts ?? [];
  if (receipts.length === 0) return;
  const journalKeys = new Set(journal.map(({ mutation_key: key }) => key));
  if (receipts.some(({ mutation_key: key }) => journalKeys.has(key))) {
    addViolation(violations, 'mutation-journal-conflict');
  }
  if (journal.length > 0
      && !validatedJournalFinalStateMatchesCurrent(state, journal, history, mapId)) {
    addViolation(violations, 'mutation-journal-conflict');
  }
  for (const receipt of receipts) {
    const historicalState = stateAtMutationReceiptSequence(
      state,
      journal,
      history,
      receipt.journal_sequence,
    );
    if (!historicalState || !mutationReceiptMatchesState(receipt, historicalState, mapId)) {
      addViolation(violations, 'mutation-journal-conflict');
    }
  }
}

function contextsFromDurableState(state, mapId, journal) {
  const contexts = new Map();
  const violationCodes = [];
  const history = reconstructJournalHistory(state, mapId, journal, violationCodes);
  validateMutationReceipts(state, mapId, journal, history, violationCodes);
  const confirmations = state.recovery_confirmations ?? [];

  for (const [index, historical] of history.entries()) {
    if (!historical) continue;
    const { entry } = historical;
    if (!['release_claim', 'reclaim_expired_claim'].includes(entry.operation)) continue;
    const confirmationIndex = confirmations.findIndex((confirmation) =>
      confirmationMatchesFenceJournal(confirmation, entry, mapId));
    const context = contexts.get(entry.ticket_id) ?? defaultContext();
    if (confirmationIndex >= 0) {
      if (entry.operation === 'release_claim') {
        context.lastReleaseConfirmationRevision = entry.result.ticket_revision;
      } else {
        context.lastFullInspectionRevision = entry.result.ticket_revision;
      }
      contexts.set(entry.ticket_id, context);
      continue;
    }
    if (index !== journal.length - 1) {
      addViolation(violationCodes, 'mutation-journal-conflict');
      continue;
    }
    if (entry.operation === 'release_claim') {
      context.releaseConfirmationRequiredAtRevision = entry.result.ticket_revision;
    } else {
      context.inspectionRequiredAtRevision = entry.result.ticket_revision;
    }
    contexts.set(entry.ticket_id, context);
  }

  for (const ticket of state.tickets) {
    const context = contexts.get(ticket.id);
    const persisted = contextFromRecoveryHold(ticket);
    if (!context) {
      if (ticket.recovery_hold?.code === 'reclaim-inspection-required'
          || ticket.recovery_hold?.code === 'release-confirmation-required') {
        addViolation(violationCodes, 'mutation-journal-conflict');
      }
      continue;
    }
    const pendingRelease = context.releaseConfirmationRequiredAtRevision !== null;
    const pendingInspection = context.inspectionRequiredAtRevision !== null;
    if (pendingRelease || pendingInspection) {
        if (confirmations.length > 0
            && persisted.releaseConfirmationRequiredAtRevision === null
            && persisted.inspectionRequiredAtRevision === null) {
          addViolation(violationCodes, 'mutation-journal-conflict');
        }
        if ((persisted.releaseConfirmationRequiredAtRevision !== null
            || persisted.inspectionRequiredAtRevision !== null)
            && (persisted.releaseConfirmationRequiredAtRevision
              !== context.releaseConfirmationRequiredAtRevision
              || persisted.inspectionRequiredAtRevision
                !== context.inspectionRequiredAtRevision)) {
          addViolation(violationCodes, 'mutation-journal-conflict');
        }
    } else if (persisted.releaseConfirmationRequiredAtRevision !== null
        || persisted.inspectionRequiredAtRevision !== null) {
      addViolation(violationCodes, 'mutation-journal-conflict');
    }
  }

  return { contexts, violationCodes, history };
}

export function evaluateRecoveryTrace(input) {
  const normalized = normalizeInput(input);
  let state = clone(normalized.initialState);
  let journal = clone(normalized.mutationJournal);
  const recovered = contextsFromDurableState(state, normalized.map_id, journal);
  let contexts = recovered.contexts;
  let journalHistory = recovered.history;
  const transitions = [];
  const violationCodes = [...recovered.violationCodes];
  const recoveryInvalid = recovered.violationCodes.length > 0;

  if (!recoveryInvalid && journalCapacityExceeded(state, journal, normalized.operations)) {
    const stateSha256 = sha256(state);
    const capacityViolation = 'journal-capacity-exceeded';
    addViolation(violationCodes, capacityViolation);
    for (const [index, operation] of normalized.operations.entries()) {
      const context = contexts.get(operation.ticket_id) ?? defaultContext();
      transitions.push({
        index,
        operation: operation.operation,
        ticket_id: operation.ticket_id,
        beforeStateSha256: stateSha256,
        afterStateSha256: stateSha256,
        deltas: [],
        replayed: false,
        mutationResult: null,
        readResult: null,
        inspection: {
          requiredAtRevision: context.inspectionRequiredAtRevision,
          lastFullInspectionRevision: context.lastFullInspectionRevision,
          releaseConfirmationRequiredAtRevision:
            context.releaseConfirmationRequiredAtRevision,
          lastReleaseConfirmationRevision: context.lastReleaseConfirmationRevision,
        },
        violationCodes: [capacityViolation],
      });
    }
    const finalState = clone(state);
    return {
      schemaVersion: SCHEMA_VERSION,
      map_id: normalized.map_id,
      valid: false,
      operationOrder: normalized.operations.map(({ operation }) => operation),
      transitions,
      frontier: frontier(state, normalized.map_id),
      finalState,
      finalStateSha256: sha256(finalState),
      mutationJournal: clone(journal),
      externalActionCount: state.external_actions.length,
      violationCodes,
    };
  }

  for (const [index, operation] of normalized.operations.entries()) {
    const beforeStateSha256 = sha256(state);
    const applied = applyOperation(
      state,
      operation,
      normalized.now,
      normalized.map_id,
      contexts,
      journal,
      recoveryInvalid,
      journalHistory,
    );
    const beforeState = state;
    state = applied.state;
    contexts = applied.contexts;
    journal = applied.journal;
    if (applied.journalHistory) journalHistory = applied.journalHistory;
    const afterStateSha256 = sha256(state);
    for (const code of applied.violations) addViolation(violationCodes, code);
    const context = contexts.get(operation.ticket_id) ?? defaultContext();
    transitions.push({
      index,
      operation: operation.operation,
      ticket_id: operation.ticket_id,
      beforeStateSha256,
      afterStateSha256,
      deltas: stateDeltas(beforeState, state, operation.ticket_id),
      replayed: applied.replayed,
      mutationResult: applied.mutationResult,
      readResult: applied.readResult,
      inspection: {
        requiredAtRevision: context.inspectionRequiredAtRevision,
        lastFullInspectionRevision: context.lastFullInspectionRevision,
        releaseConfirmationRequiredAtRevision:
          context.releaseConfirmationRequiredAtRevision,
        lastReleaseConfirmationRevision: context.lastReleaseConfirmationRevision,
      },
      violationCodes: applied.violations,
    });
  }

  for (const context of contexts.values()) {
    if (context.releaseConfirmationRequiredAtRevision !== null
        && !violationCodes.includes('mutation-journal-conflict')) {
      addViolation(violationCodes, 'release-confirmation-required');
    }
  }
  const finalState = clone(state);
  return {
    schemaVersion: SCHEMA_VERSION,
    map_id: normalized.map_id,
    valid: violationCodes.length === 0,
    operationOrder: normalized.operations.map(({ operation }) => operation),
    transitions,
    frontier: frontier(state, normalized.map_id),
    finalState,
    finalStateSha256: sha256(finalState),
    mutationJournal: clone(journal),
    externalActionCount: state.external_actions.length,
    violationCodes,
  };
}

async function readStdin() {
  let input = '';
  let size = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    size += byteLength(chunk);
    if (size > RECOVERY_LIMITS.inputBytes) {
      fail(`input must not exceed ${RECOVERY_LIMITS.inputBytes} serialized UTF-8 bytes.`);
    }
    input += chunk;
  }
  return input;
}

async function main() {
  try {
    const text = await readStdin();
    if (text.trim().length === 0) fail('stdin must contain one JSON object.');
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      fail('stdin is not valid JSON.');
    }
    process.stdout.write(`${JSON.stringify(evaluateRecoveryTrace(input))}\n`);
  } catch (error) {
    const code = error?.code === 'malformed-input' ? error.code : 'checker-error';
    process.stdout.write(`${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      error: {
        code,
        message: error instanceof Error ? error.message : 'Unknown checker error.',
      },
    })}\n`);
    process.exitCode = 1;
  }
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntryPoint) main();
