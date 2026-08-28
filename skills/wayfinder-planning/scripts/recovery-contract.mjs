#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const TICKET_TYPES = new Set(['research', 'prototype', 'grilling', 'task']);
const TICKET_STATUSES = new Set(['open', 'blocked', 'closed']);
const TASK_OUTCOMES = new Set(['succeeded', 'unknown']);
const MAX_LEASE_DURATION_MS = 2_592_000_000;
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
  inputJournalEntries: 128,
  outputJournalEntries: 256,
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
    if (value.recovery_hold !== undefined && value.recovery_hold !== null) {
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
    recovery_hold: null,
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
  return {
    tickets: normalizedTickets.sort((left, right) => compareStrings(left.id, right.id)),
    external_actions: externalActions,
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
      return {
        ticket_revision: ticketRevision,
        progress_key: stableIdentity(value.progress_key, `${path}.progress_key`),
        record_revision: recordRevision,
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
      };
    }
    case 'reclaim_expired_claim':
      return {
        ticket_revision: ticketRevision,
        claim_token: stableIdentity(value.claim_token, `${path}.claim_token`),
        expires_at: timestamp(value.expires_at, `${path}.expires_at`),
      };
    default:
      fail(`${path} has unsupported mutation operation ${operation}.`);
  }
}

function normalizeMutationJournal(value) {
  const entries = normalizeArray(
    value,
    'mutationJournal',
    RECOVERY_LIMITS.inputJournalEntries,
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
    return {
      mutation_key: stableIdentity(entry.mutation_key, `${path}.mutation_key`),
      operation,
      ticket_id: stableIdentity(entry.ticket_id, `${path}.ticket_id`),
      fingerprint_sha256: fingerprint,
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
  return {
    schemaVersion: SCHEMA_VERSION,
    map_id: stableIdentity(input.map_id, 'map_id'),
    now,
    initialState: normalizeInitialState(input.initialState, now),
    operations: normalizeOperations(input.operations),
    mutationJournal: normalizeMutationJournal(input.mutationJournal),
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

function findReplay(journal, operation, violations) {
  const entry = journal.find(({ mutation_key: key }) => key === operation.mutation_key);
  if (!entry) return null;
  const fingerprint = operationFingerprint(operation);
  if (entry.operation !== operation.operation
      || entry.ticket_id !== operation.ticket_id
      || entry.fingerprint_sha256 !== fingerprint) {
    addViolation(violations, 'mutation-key-conflict');
    return { conflict: true };
  }
  return { conflict: false, result: clone(entry.result) };
}

function appendJournal(journal, operation, result, violations) {
  if (journal.length >= RECOVERY_LIMITS.outputJournalEntries) {
    addViolation(violations, 'mutation-journal-capacity-exhausted');
    return null;
  }
  return [
    ...journal,
    {
      mutation_key: operation.mutation_key,
      operation: operation.operation,
      ticket_id: operation.ticket_id,
      fingerprint_sha256: operationFingerprint(operation),
      result: clone(result),
    },
  ];
}

function applyGetTicket(ticket, operation, context, violations) {
  if (!expectedRevisionMatches(ticket, operation, violations)) return null;
  if (operation.full !== true) {
    addViolation(violations, 'full-inspection-required');
    return null;
  }
  context.lastFullInspectionRevision = ticket.revision;
  if (context.inspectionRequiredAtRevision === ticket.revision) {
    context.inspectionRequiredAtRevision = null;
  }
  if (context.releaseConfirmationRequiredAtRevision === ticket.revision) {
    if (ticket.claim !== null) {
      addViolation(violations, 'release-confirmation-claim-present');
      return null;
    }
    context.releaseConfirmationRequiredAtRevision = null;
    context.lastReleaseConfirmationRevision = ticket.revision;
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
  return {
    state: {
      tickets,
      external_actions: state.external_actions,
    },
    ticket,
  };
}

function applyOperation(state, operation, now, mapId, contexts, journal) {
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
    const replay = findReplay(journal, operation, violations);
    if (replay) {
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
    if (journal.length >= RECOVERY_LIMITS.outputJournalEntries) {
      addViolation(violations, 'mutation-journal-capacity-exhausted');
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
      readResult = applyGetTicket(candidate.ticket, operation, context, violations);
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
  if (MUTATION_OPERATIONS.has(operation.operation)) {
    nextJournal = appendJournal(journal, operation, mutationResult, violations);
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
  }
  return {
    state: candidate.state,
    contexts: candidateContexts,
    journal: nextJournal,
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

export function evaluateRecoveryTrace(input) {
  const normalized = normalizeInput(input);
  let state = clone(normalized.initialState);
  let contexts = new Map();
  let journal = clone(normalized.mutationJournal);
  const transitions = [];
  const violationCodes = [];

  for (const [index, operation] of normalized.operations.entries()) {
    const beforeStateSha256 = sha256(state);
    const applied = applyOperation(
      state,
      operation,
      normalized.now,
      normalized.map_id,
      contexts,
      journal,
    );
    const beforeState = state;
    state = applied.state;
    contexts = applied.contexts;
    journal = applied.journal;
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
    if (context.releaseConfirmationRequiredAtRevision !== null) {
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
