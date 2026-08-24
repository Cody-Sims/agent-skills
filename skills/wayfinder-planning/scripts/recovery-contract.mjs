#!/usr/bin/env node

import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const TICKET_TYPES = new Set(['research', 'prototype', 'grilling', 'task']);
const TICKET_STATUSES = new Set(['open', 'blocked', 'closed']);
const TASK_OUTCOMES = new Set(['succeeded', 'unknown']);
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

function requiredString(value, path) {
  if (typeof value !== 'string' || value.length === 0) fail(`${path} must be a non-empty string.`);
  return value;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function optionalNullableString(value, path) {
  if (value === undefined || value === null) return null;
  return requiredString(value, path);
}

function positiveRevision(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${path} must be a positive safe integer.`);
  return value;
}

function timestamp(value, path) {
  requiredString(value, path);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail(`${path} must be a valid timestamp.`);
  return new Date(milliseconds).toISOString();
}

function normalizeClaim(value, path) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail(`${path} must be an object or null.`);
  return {
    claim_token: requiredString(value.claim_token, `${path}.claim_token`),
    owner_id: requiredString(value.owner_id, `${path}.owner_id`),
    session_id: requiredString(value.session_id, `${path}.session_id`),
    acquired_at: timestamp(value.acquired_at, `${path}.acquired_at`),
    expires_at: timestamp(value.expires_at, `${path}.expires_at`),
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
    evidence_reference: requiredString(
      value.evidence_reference,
      `${path}.evidence_reference`,
    ),
    actor_id: requiredString(value.actor_id, `${path}.actor_id`),
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
    idempotency_key: requiredString(value.idempotency_key, `${path}.idempotency_key`),
    authorization_reference: requiredString(
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
  const outcome = requiredString(value.outcome, `${path}.outcome`);
  if (!TASK_OUTCOMES.has(outcome)) {
    fail(`${path}.outcome must be succeeded or unknown.`);
  }
  return {
    ticket_id: requiredString(value.ticket_id, `${path}.ticket_id`),
    intent: requiredString(value.intent, `${path}.intent`),
    idempotency_key: requiredString(value.idempotency_key, `${path}.idempotency_key`),
    claim_token: requiredString(value.claim_token, `${path}.claim_token`),
    owner_id: requiredString(value.owner_id, `${path}.owner_id`),
    session_id: requiredString(value.session_id, `${path}.session_id`),
    external_system: requiredString(value.external_system, `${path}.external_system`),
    lookup_reference: requiredString(
      value.lookup_reference,
      `${path}.lookup_reference`,
    ),
    outcome,
    performed_at: timestamp(value.performed_at, `${path}.performed_at`),
  };
}

function normalizeReceipt(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  return {
    external_system: requiredString(value.external_system, `${path}.external_system`),
    idempotency_key: requiredString(value.idempotency_key, `${path}.idempotency_key`),
    result: requiredString(value.result, `${path}.result`),
    lookup_reference: requiredString(
      value.lookup_reference,
      `${path}.lookup_reference`,
    ),
  };
}

function normalizeReconciliationEvidence(value) {
  if (!isRecord(value)
      || !isNonEmptyString(value.authority_reference)
      || !isNonEmptyString(value.conclusion)) {
    return null;
  }
  const normalized = {
    authority_reference: value.authority_reference,
    conclusion: value.conclusion,
  };
  if (value.task_action !== undefined) {
    if (!isRecord(value.task_action)
        || value.task_action.state !== 'succeeded'
        || !isRecord(value.task_action.receipt)) {
      return null;
    }
    const receipt = value.task_action.receipt;
    if (!isNonEmptyString(receipt.external_system)
        || !isNonEmptyString(receipt.idempotency_key)
        || receipt.result !== 'succeeded'
        || !isNonEmptyString(receipt.lookup_reference)) {
      return null;
    }
    normalized.task_action = {
      state: 'succeeded',
      receipt: {
        external_system: receipt.external_system,
        idempotency_key: receipt.idempotency_key,
        result: receipt.result,
        lookup_reference: receipt.lookup_reference,
      },
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
    fail(`${path}.reconciliation_evidence must be authoritative.`);
  }
  return {
    block_revision: positiveRevision(value.block_revision, `${path}.block_revision`),
    actor_type: 'human',
    actor_id: requiredString(value.actor_id, `${path}.actor_id`),
    authorization_reference: requiredString(
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

function normalizeProgressRecord(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  if (!isRecord(value.payload)) fail(`${path}.payload must be an object.`);
  return {
    progress_key: requiredString(value.progress_key, `${path}.progress_key`),
    payload: clone(value.payload),
    recorded_at: timestamp(value.recorded_at, `${path}.recorded_at`),
    revision: positiveRevision(value.revision, `${path}.revision`),
  };
}

function normalizeArray(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return clone(value);
}

function normalizeTicket(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const id = requiredString(value.id, `${path}.id`);
  const type = requiredString(value.type, `${path}.type`);
  if (!TICKET_TYPES.has(type)) fail(`${path}.type is not supported.`);
  const status = requiredString(value.status, `${path}.status`);
  if (!TICKET_STATUSES.has(status)) fail(`${path}.status is not supported.`);
  const revision = positiveRevision(value.revision, `${path}.revision`);
  const blockerIds = value.blocker_ids === undefined ? [] : value.blocker_ids;
  if (!Array.isArray(blockerIds)
      || blockerIds.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    fail(`${path}.blocker_ids must contain non-empty strings.`);
  }
  const block = normalizeBlock(value.block, `${path}.block`);
  if (status === 'blocked' && !block) fail(`${path}.block is required for blocked tickets.`);
  if (status !== 'blocked' && block) fail(`${path}.block requires blocked status.`);
  const history = value.block_history === undefined
    ? block ? [block] : []
    : normalizeArray(value.block_history, `${path}.block_history`)
      .map((entry, index) => normalizeBlock(entry, `${path}.block_history[${index}]`));
  const blockRevisions = history.map(({ blocked_revision: revision }) => revision);
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
  const progress = value.progress_records === undefined
    ? []
    : normalizeArray(value.progress_records, `${path}.progress_records`)
      .map((entry, index) => normalizeProgressRecord(
        entry,
        `${path}.progress_records[${index}]`,
      ));
  const progressKeys = progress.map(({ progress_key: key }) => key);
  if (new Set(progressKeys).size !== progressKeys.length) {
    fail(`${path}.progress_records contains duplicate progress keys.`);
  }
  const taskAction = normalizeTaskAction(value.task_action, `${path}.task_action`);
  if (type !== 'task' && taskAction !== null) {
    fail(`${path}.task_action requires task type.`);
  }
  const pendingExternalAction = normalizePendingExternalAction(
    value.pending_external_action,
    `${path}.pending_external_action`,
  );
  if (pendingExternalAction) {
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
  }
  return {
    id,
    parent_map_id: optionalNullableString(value.parent_map_id, `${path}.parent_map_id`),
    type,
    status,
    revision,
    blocker_ids: [...blockerIds].sort(compareStrings),
    claim: normalizeClaim(value.claim, `${path}.claim`),
    block,
    block_history: history,
    comments: normalizeArray(value.comments, `${path}.comments`),
    evidence: normalizeArray(value.evidence, `${path}.evidence`),
    progress_records: progress,
    task_action: taskAction,
    pending_external_action: pendingExternalAction,
    recovery_hold: null,
  };
}

function normalizeInitialState(value) {
  const state = value === undefined ? {} : value;
  if (!isRecord(state)) fail('initialState must be an object.');
  const tickets = state.tickets === undefined ? [] : state.tickets;
  if (!Array.isArray(tickets)) fail('initialState.tickets must be an array.');
  const normalizedTickets = tickets.map((entry, index) =>
    normalizeTicket(entry, `initialState.tickets[${index}]`));
  const ids = normalizedTickets.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) fail('initialState.tickets contains duplicate IDs.');
  for (const ticket of normalizedTickets) {
    for (const blockerId of ticket.blocker_ids) {
      if (!ids.includes(blockerId)) {
        fail(`initialState ticket ${ticket.id} references missing blocker ${blockerId}.`);
      }
    }
  }
  return {
    tickets: normalizedTickets.sort((left, right) => compareStrings(left.id, right.id)),
    external_actions: [],
  };
}

function normalizeOperations(value) {
  if (!Array.isArray(value)) fail('operations must be an array.');
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`operations[${index}] must be an object.`);
    const operation = requiredString(entry.operation, `operations[${index}].operation`);
    if (!OPERATIONS.has(operation)) fail(`operations[${index}] has unknown operation ${operation}.`);
    const normalized = { ...clone(entry), operation };
    delete normalized.after;
    return normalized;
  });
}

function normalizeInput(input) {
  if (!isRecord(input)) fail('input must be a JSON object.');
  if (input.schemaVersion !== SCHEMA_VERSION) {
    fail(`schemaVersion must equal ${SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    now: timestamp(input.now, 'now'),
    initialState: normalizeInitialState(input.initialState),
    operations: normalizeOperations(input.operations),
  };
}

function ticketById(state, operation, violations) {
  const ticketId = requiredString(operation.ticket_id, `${operation.operation}.ticket_id`);
  const ticket = state.tickets.find((entry) => entry.id === ticketId);
  if (!ticket) violations.push('ticket-not-found');
  return ticket;
}

function addViolation(violations, code) {
  if (!violations.includes(code)) violations.push(code);
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
  const claim = ticket.claim;
  if (!claim
      || claim.claim_token !== operation.claim_token
      || claim.owner_id !== operation.owner_id
      || claim.session_id !== operation.session_id
      || Date.parse(claim.expires_at) <= Date.parse(now)) {
    addViolation(violations, 'claim-conflict');
    return false;
  }
  return true;
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

function applyGetTicket(state, operation, context, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  if (operation.full !== true) {
    addViolation(violations, 'full-inspection-required');
    return;
  }
  context.lastFullInspectionRevision = ticket.revision;
  if (context.inspectionRequiredAtRevision === ticket.revision) {
    context.inspectionRequiredAtRevision = null;
  }
}

function applyRecordProgress(state, operation, now, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  if (!activeClaimMatches(ticket, operation, now, violations)) return;
  const progressKey = requiredString(operation.progress_key, 'record_progress.progress_key');
  if (!isRecord(operation.payload)) fail('record_progress.payload must be an object.');
  const existing = ticket.progress_records.find((entry) => entry.progress_key === progressKey);
  if (existing) {
    if (!isDeepStrictEqual(existing.payload, operation.payload)) {
      addViolation(violations, 'progress-key-conflict');
    }
    return;
  }
  ticket.revision += 1;
  ticket.progress_records.push({
    progress_key: progressKey,
    payload: clone(operation.payload),
    recorded_at: now,
    revision: ticket.revision,
  });
}

function applyRecordTaskIntent(state, operation, now, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  if (!activeClaimMatches(ticket, operation, now, violations)) return;
  if (ticket.type !== 'task') {
    addViolation(violations, 'task-operation-on-non-task');
    return;
  }
  const intended = {
    intent: requiredString(operation.intent, 'record_task_intent.intent'),
    idempotency_key: requiredString(
      operation.idempotency_key,
      'record_task_intent.idempotency_key',
    ),
    authorization_reference: requiredString(
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
    }
    return;
  }
  ticket.task_action = intended;
  ticket.revision += 1;
}

function applyExternalAction(state, operation, now, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket) return;
  if (!expectedRevisionMatches(ticket, operation, violations)) return;
  if (!activeClaimMatches(ticket, operation, now, violations)) return;
  if (ticket.pending_external_action) {
    addViolation(violations, 'pending-external-action');
    return;
  }
  const key = requiredString(operation.idempotency_key, 'external_action.idempotency_key');
  const receiptKey = ticket.task_action?.external_receipt?.idempotency_key;
  if (receiptKey) {
    addViolation(
      violations,
      receiptKey === key ? 'duplicate-external-action' : 'new-action-key-after-receipt',
    );
    return;
  }
  if (!ticket.task_action || ticket.task_action.idempotency_key !== key) {
    addViolation(violations, 'external-action-without-intent');
    return;
  }
  if (!TASK_OUTCOMES.has(operation.outcome)) {
    addViolation(violations, 'invalid-task-outcome');
    return;
  }
  if (state.external_actions.some((entry) =>
    entry.ticket_id === ticket.id && entry.idempotency_key === key)) {
    addViolation(violations, 'duplicate-external-action');
    return;
  }
  state.external_actions.push({
    ticket_id: ticket.id,
    idempotency_key: key,
    external_system: requiredString(
      operation.external_system,
      'external_action.external_system',
    ),
    lookup_reference: requiredString(
      operation.lookup_reference,
      'external_action.lookup_reference',
    ),
    outcome: requiredString(operation.outcome, 'external_action.outcome'),
    performed_at: null,
  });
  ticket.pending_external_action = {
    ticket_id: ticket.id,
    intent: ticket.task_action.intent,
    idempotency_key: key,
    claim_token: ticket.claim.claim_token,
    owner_id: ticket.claim.owner_id,
    session_id: ticket.claim.session_id,
    external_system: operation.external_system,
    lookup_reference: operation.lookup_reference,
    outcome: operation.outcome,
    performed_at: now,
  };
}

function applyRecordTaskReceipt(state, operation, now, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  if (!activeClaimMatches(ticket, operation, now, violations)) return;
  if (!ticket.task_action) {
    addViolation(violations, 'task-receipt-without-intent');
    return;
  }
  const key = requiredString(
    operation.idempotency_key,
    'record_task_receipt.idempotency_key',
  );
  if (key !== ticket.task_action.idempotency_key) {
    addViolation(violations, 'task-action-key-conflict');
    return;
  }
  if (!TASK_OUTCOMES.has(operation.outcome)) {
    addViolation(violations, 'invalid-task-outcome');
    return;
  }
  const receipt = normalizeReceipt(operation.receipt, 'record_task_receipt.receipt');
  if (receipt.idempotency_key !== key) {
    addViolation(violations, 'task-action-key-conflict');
    return;
  }
  if (receipt.result !== operation.outcome) {
    addViolation(violations, 'task-receipt-conflict');
    return;
  }
  const pending = ticket.pending_external_action;
  if (pending
      && (pending.idempotency_key !== key
        || pending.external_system !== receipt.external_system
        || pending.lookup_reference !== receipt.lookup_reference
        || pending.outcome !== operation.outcome)) {
    addViolation(violations, 'task-receipt-conflict');
    return;
  }
  const nextState = operation.outcome === 'unknown'
    ? 'outcome_unknown'
    : 'succeeded';
  if (ticket.task_action.external_receipt) {
    if (ticket.task_action.state === nextState
        && isDeepStrictEqual(ticket.task_action.external_receipt, receipt)) {
      return;
    }
    addViolation(violations, 'task-receipt-conflict');
    return;
  }
  ticket.task_action.external_receipt = receipt;
  ticket.task_action.state = nextState;
  ticket.pending_external_action = null;
  ticket.revision += 1;
  setUnknownOutcomeHold(ticket);
}

function applyBlockTicket(state, operation, now, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  if (!activeClaimMatches(ticket, operation, now, violations)) return;
  if (operation.confirmed !== true) {
    addViolation(violations, 'block-unconfirmed');
    setUnknownOutcomeHold(ticket);
    return;
  }
  if (ticket.status !== 'open') {
    addViolation(violations, 'invalid-lifecycle-transition');
    return;
  }
  ticket.revision += 1;
  const block = {
    reason: requiredString(operation.reason, 'block_ticket.reason'),
    evidence_reference: requiredString(
      operation.evidence_reference,
      'block_ticket.evidence_reference',
    ),
    actor_id: requiredString(operation.actor_id, 'block_ticket.actor_id'),
    blocked_at: now,
    blocked_revision: ticket.revision,
    requires_human_resolution: true,
  };
  ticket.status = 'blocked';
  ticket.block = block;
  ticket.block_history.push(block);
  ticket.recovery_hold = null;
}

function applyReleaseClaim(state, operation, now, context, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  if (!activeClaimMatches(ticket, operation, now, violations)) return;
  if (ticket.pending_external_action) {
    addViolation(violations, 'pending-external-action');
    return;
  }
  if (unknownOutcome(ticket)
      && (ticket.status !== 'blocked'
        || ticket.block?.requires_human_resolution !== true
        || context.lastFullInspectionRevision !== ticket.revision)) {
    addViolation(violations, 'release-before-confirmed-block');
    setUnknownOutcomeHold(ticket);
    return;
  }
  ticket.claim = null;
  ticket.revision += 1;
}

function applyUnblockTicket(state, operation, now, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  if (ticket.pending_external_action) {
    addViolation(violations, 'pending-external-action');
    return;
  }
  if (ticket.status !== 'blocked') {
    addViolation(violations, 'invalid-lifecycle-transition');
    return;
  }
  if (!Number.isSafeInteger(operation.block_revision)
      || operation.block_revision !== ticket.block.blocked_revision) {
    addViolation(violations, 'block-revision-conflict');
    return;
  }
  if (operation.actor_type !== 'human') {
    addViolation(violations, 'human-required-for-unblock');
    return;
  }
  if (!isNonEmptyString(operation.actor_id)
      || !isNonEmptyString(operation.authorization_reference)) {
    addViolation(violations, 'human-authorization-required');
    return;
  }
  const reconciliationEvidence = normalizeReconciliationEvidence(
    operation.reconciliation_evidence,
  );
  if (!reconciliationEvidence) {
    addViolation(violations, 'authoritative-reconciliation-required');
    return;
  }
  if (unknownOutcome(ticket)) {
    const resolution = reconciliationEvidence.task_action;
    if (!resolution
        || resolution.state !== 'succeeded'
        || resolution.receipt.result !== 'succeeded') {
      addViolation(violations, 'unresolved-external-outcome');
      return;
    }
    if (resolution.receipt.idempotency_key !== ticket.task_action.idempotency_key) {
      addViolation(violations, 'task-action-key-conflict');
      return;
    }
    if (ticket.task_action.external_receipt
        && resolution.receipt.external_system
          !== ticket.task_action.external_receipt.external_system) {
      addViolation(violations, 'task-receipt-conflict');
      return;
    }
    ticket.task_action.state = 'succeeded';
    ticket.task_action.external_receipt = resolution.receipt;
  }
  const resultingRevision = ticket.revision + 1;
  const reconciliation = {
    block_revision: operation.block_revision,
    actor_type: 'human',
    actor_id: operation.actor_id,
    authorization_reference: operation.authorization_reference,
    reconciliation_evidence: reconciliationEvidence,
    reconciled_at: now,
    resulting_revision: resultingRevision,
  };
  ticket.block_history = ticket.block_history.map((block) =>
    block.blocked_revision === operation.block_revision
      ? { ...block, reconciliation }
      : block);
  ticket.status = 'open';
  ticket.block = null;
  ticket.recovery_hold = null;
  ticket.revision = resultingRevision;
}

function applyReclaimExpiredClaim(state, operation, now, context, violations) {
  const ticket = ticketById(state, operation, violations);
  if (!ticket || !expectedRevisionMatches(ticket, operation, violations)) return;
  const claim = ticket.claim;
  if (!claim
      || claim.claim_token !== operation.observed_claim_token
      || Date.parse(now) < Date.parse(claim.expires_at)) {
    addViolation(violations, 'claim-not-reclaimable');
    return;
  }
  const duration = operation.lease_duration_seconds;
  if (!Number.isSafeInteger(duration) || duration < 1) {
    fail('reclaim_expired_claim.lease_duration_seconds must be a positive safe integer.');
  }
  const newClaimToken = requiredString(
    operation.new_claim_token,
    'reclaim_expired_claim.new_claim_token',
  );
  const ownerId = requiredString(operation.owner_id, 'reclaim_expired_claim.owner_id');
  const sessionId = requiredString(operation.session_id, 'reclaim_expired_claim.session_id');
  if (newClaimToken === claim.claim_token) {
    addViolation(violations, 'reclaim-token-not-fresh');
    return;
  }
  if (sessionId === claim.session_id) {
    addViolation(violations, 'reclaim-session-not-fresh');
    return;
  }
  ticket.revision += 1;
  ticket.claim = {
    claim_token: newClaimToken,
    owner_id: ownerId,
    session_id: sessionId,
    acquired_at: now,
    expires_at: new Date(Date.parse(now) + duration * 1000).toISOString(),
  };
  context.inspectionRequiredAtRevision = ticket.revision;
  context.lastFullInspectionRevision = null;
}

function applyOperation(state, operation, now, contexts) {
  const violations = [];
  const ticketId = typeof operation.ticket_id === 'string' ? operation.ticket_id : null;
  const context = ticketId
    ? contexts.get(ticketId) ?? {
      inspectionRequiredAtRevision: null,
      lastFullInspectionRevision: null,
    }
    : null;
  if (ticketId && !contexts.has(ticketId)) contexts.set(ticketId, context);
  if (context?.inspectionRequiredAtRevision !== null
      && operation.operation !== 'get_ticket') {
    addViolation(violations, 'work-before-full-inspection');
    return violations;
  }
  switch (operation.operation) {
    case 'get_ticket':
      applyGetTicket(state, operation, context, violations);
      break;
    case 'record_progress':
      applyRecordProgress(state, operation, now, violations);
      break;
    case 'record_task_intent':
      applyRecordTaskIntent(state, operation, now, violations);
      break;
    case 'external_action':
      applyExternalAction(state, operation, now, violations);
      if (violations.length === 0) state.external_actions.at(-1).performed_at = now;
      break;
    case 'record_task_receipt':
      applyRecordTaskReceipt(state, operation, now, violations);
      break;
    case 'block_ticket':
      applyBlockTicket(state, operation, now, violations);
      break;
    case 'release_claim':
      applyReleaseClaim(state, operation, now, context, violations);
      break;
    case 'unblock_ticket':
      applyUnblockTicket(state, operation, now, violations);
      break;
    case 'reclaim_expired_claim':
      applyReclaimExpiredClaim(state, operation, now, context, violations);
      break;
    default:
      fail(`unknown operation ${operation.operation}.`);
  }
  return violations;
}

function frontier(state) {
  const byId = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  return state.tickets
    .filter((ticket) =>
      ticket.parent_map_id !== null
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
  const state = clone(normalized.initialState);
  const transitions = [];
  const violationCodes = [];
  const contexts = new Map();

  for (const [index, operation] of normalized.operations.entries()) {
    const before = clone(state);
    const transitionViolations = applyOperation(
      state,
      operation,
      normalized.now,
      contexts,
    );
    const context = contexts.get(operation.ticket_id) ?? {
      inspectionRequiredAtRevision: null,
      lastFullInspectionRevision: null,
    };
    for (const code of transitionViolations) addViolation(violationCodes, code);
    transitions.push({
      index,
      operation: operation.operation,
      before,
      after: clone(state),
      inspection: {
        requiredAtRevision: context.inspectionRequiredAtRevision,
        lastFullInspectionRevision: context.lastFullInspectionRevision,
      },
      violationCodes: transitionViolations,
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    valid: violationCodes.length === 0,
    operationOrder: normalized.operations.map(({ operation }) => operation),
    transitions,
    frontier: frontier(state),
    finalState: clone(state),
    externalActionCount: state.external_actions.length,
    violationCodes,
  };
}

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
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
