#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const SCHEMA_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
const STOP_REASONS = new Set([
  'human-grilling',
  'authorization',
  'policy-input',
  'ambiguous-scope',
  'blocked-frontier',
  'claimed-frontier',
  'empty-frontier',
  'map-clear',
  'safety-failure',
  'recovery-failure',
  'hard-budget-exhaustion',
]);
const OUTCOMES = new Set(['succeeded', 'stopped', ...STOP_REASONS]);
const WORKER_OPERATIONS = new Set([
  'read',
  'inspect',
  'source-read',
  'research',
  'observe',
  'list',
  'report',
]);
const CONTROLLER_OPERATIONS = new Set([
  'read-frontier',
  'select',
  'claim',
  'inspect',
  'research',
  'resolve',
  'work',
  'consolidate-workers',
  'synchronize',
  'close',
  'verify-close',
  'release',
  'verify-release',
  'checkpoint',
  'report',
  'recompute-frontier',
]);
const WORK_DISPATCH_OPERATIONS = new Set([
  'read-frontier',
  'select',
  'claim',
  'inspect',
  'research',
  'resolve',
  'work',
  'consolidate-workers',
]);
const SYNC_DISPATCH_OPERATIONS = new Set([
  'synchronize',
  'close',
  'verify-close',
  'release',
  'verify-release',
  'checkpoint',
  'report',
  'recompute-frontier',
]);
const FORBIDDEN_OPERATIONS = new Set([
  'acknowledge',
  'agent',
  'call-external',
  'commit',
  'continue',
  'delete',
  'execute-agent',
  'external-call',
  'git',
  'implementation',
  'mutate',
  'next',
  'pull-request',
  'push',
  'unblock',
]);
const FORBIDDEN_WORKER_OPERATIONS = new Set([
  'claim',
  'mutate',
  'unblock',
  'call-external',
  'external-call',
]);
const CLAIM_SUCCESS_LIFECYCLE = [
  'acquired',
  'inspected',
  'synchronized',
  'close-verified',
  'consumed',
];
const CLAIM_STOP_LIFECYCLE = [
  'acquired',
  'inspected',
  'released',
  'release-verified',
];
const STOP_FLAG_KEYS = new Map([
  ['human-grilling', 'human_grilling'],
  ['authorization', 'authorization'],
  ['policy-input', 'policy_input'],
  ['ambiguous-scope', 'ambiguous_scope'],
  ['safety-failure', 'safety_failure'],
  ['recovery-failure', 'recovery_failure'],
]);
const PROVIDER_MARKERS = new Set([
  'provider',
  'provider-native',
  'provider_counter',
  'provider-counters',
  'provider-counter',
]);
const PROVIDER_PROVENANCE_KEYS = new Set([
  'kind',
  'type',
  'source',
  'provider_id',
  'provider',
  'verifier_id',
  'verifier',
  'authenticated',
  'verified',
  'signature',
  'verification_digest',
]);

export const AUTONOMY_DEFAULTS = Object.freeze({
  hard: Object.freeze({
    time_ms: 1_800_000,
    token_units: 64_000,
    tool_calls: 64,
  }),
  reserve: Object.freeze({
    time_ms: 300_000,
    token_units: 12_000,
    tool_calls: 12,
  }),
  minimumReserve: Object.freeze({
    time_ms: 120_000,
    token_units: 4_000,
    tool_calls: 6,
  }),
  inputBytes: 1_048_576,
  maxWorkers: 128,
  maxOperations: 512,
  maxRecentCompleted: 32,
  maxDepth: 16,
  maxKeys: 128,
  maxStringBytes: 4_096,
});
export const AUTONOMY_LIMITS = AUTONOMY_DEFAULTS;

class AutonomyInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AutonomyInputError';
    this.code = 'malformed-input';
  }
}

function fail(message) {
  throw new AutonomyInputError(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validSha256(value, path) {
  meaningfulString(value, path, 64);
  if (!SHA256.test(value)) fail(`${path} must be a lowercase SHA-256 hex digest.`);
  return value;
}

function canonicalValue(value, path = 'input', depth = 0) {
  if (depth > AUTONOMY_DEFAULTS.maxDepth) {
    fail(`${path} exceeds the maximum JSON depth ${AUTONOMY_DEFAULTS.maxDepth}.`);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string'
        && byteLength(value) > AUTONOMY_DEFAULTS.maxStringBytes) {
      fail(`${path} exceeds ${AUTONOMY_DEFAULTS.maxStringBytes} UTF-8 bytes.`);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must contain finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`, depth + 1));
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort(compareStrings);
    if (keys.length > AUTONOMY_DEFAULTS.maxKeys) {
      fail(`${path} contains too many object fields.`);
    }
    const result = {};
    for (const key of keys) {
      if (value[key] === undefined) fail(`${path}.${key} must be valid JSON.`);
      result[key] = canonicalValue(value[key], `${path}.${key}`, depth + 1);
    }
    return result;
  }
  fail(`${path} must contain only JSON values.`);
}

function serializedSize(value) {
  try {
    return byteLength(JSON.stringify(value));
  } catch {
    fail('input must be finite, acyclic JSON.');
  }
}

function exactKeys(value, path, allowed, required = []) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key} is an unknown field.`);
  }
  for (const key of required) {
    if (!(key in value)) fail(`${path}.${key} is required.`);
  }
}

function meaningfulString(value, path, maximum = AUTONOMY_DEFAULTS.maxStringBytes) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a meaningful non-empty string.`);
  }
  if (byteLength(value) > maximum) fail(`${path} exceeds ${maximum} UTF-8 bytes.`);
  return value;
}

function nonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${path} must be a positive safe integer.`);
  }
  return value;
}

function parseTimestamp(value, path) {
  meaningfulString(value, path, 128);
  const match = RFC3339.exec(value);
  if (!match) fail(`${path} must be a strict RFC 3339 timestamp.`);
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
  return instant;
}

function timestamp(value, path) {
  parseTimestamp(value, path);
  return value;
}

function addViolation(violations, code) {
  if (!violations.includes(code)) violations.push(code);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function safeAdd(left, right) {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}

function normalizeBudget(input) {
  const budgetInput = input ?? {};
  exactKeys(
    budgetInput,
    'invocation.budget',
    new Set(['time_ms', 'token_units', 'tool_calls', 'reserve']),
  );
  const hard = {};
  for (const key of Object.keys(AUTONOMY_DEFAULTS.hard)) {
    hard[key] = budgetInput[key] === undefined
      ? AUTONOMY_DEFAULTS.hard[key]
      : positiveInteger(budgetInput[key], `invocation.budget.${key}`);
  }
  const reserveInput = budgetInput.reserve ?? {};
  exactKeys(
    reserveInput,
    'invocation.budget.reserve',
    new Set(['time_ms', 'token_units', 'tool_calls']),
  );
  const reserve = {};
  for (const key of Object.keys(AUTONOMY_DEFAULTS.reserve)) {
    reserve[key] = reserveInput[key] === undefined
      ? AUTONOMY_DEFAULTS.reserve[key]
      : positiveInteger(reserveInput[key], `invocation.budget.reserve.${key}`);
  }
  return { hard, reserve };
}

function normalizeInvocation(value) {
  exactKeys(
    value,
    'invocation',
    new Set(['invocation_id', 'map_id', 'owner_id', 'session_id', 'budget']),
    ['invocation_id', 'map_id', 'owner_id', 'session_id'],
  );
  return {
    invocation_id: meaningfulString(value.invocation_id, 'invocation.invocation_id'),
    map_id: meaningfulString(value.map_id, 'invocation.map_id'),
    owner_id: meaningfulString(value.owner_id, 'invocation.owner_id'),
    session_id: meaningfulString(value.session_id, 'invocation.session_id'),
    budget: normalizeBudget(value.budget),
  };
}

function normalizeOriginalRequest(value) {
  exactKeys(
    value,
    'original_request',
    new Set([
      'type',
      'clear',
      'authorized',
      'specification_approved',
      'approval_reference',
      'request',
      'request_text',
      'request_sha256',
    ]),
    ['type', 'clear', 'authorized'],
  );
  if (!['implementation', 'planning', 'research', 'other'].includes(value.type)) {
    fail('original_request.type is unsupported.');
  }
  if (typeof value.clear !== 'boolean' || typeof value.authorized !== 'boolean') {
    fail('original_request.clear and original_request.authorized must be booleans.');
  }
  if (value.specification_approved !== undefined
      && typeof value.specification_approved !== 'boolean') {
    fail('original_request.specification_approved must be a boolean.');
  }
  if (value.approval_reference !== undefined) {
    meaningfulString(value.approval_reference, 'original_request.approval_reference');
  }
  if (value.request !== undefined && value.request_text !== undefined) {
    fail('original_request.request and original_request.request_text are aliases; provide one.');
  }
  const requestText = value.request ?? value.request_text;
  if (requestText !== undefined) {
    meaningfulString(requestText, 'original_request.request', 16_384);
  }
  const suppliedRequestHash = value.request_sha256 === undefined
    ? null
    : validSha256(value.request_sha256, 'original_request.request_sha256');
  const derivedRequestHash = requestText === undefined ? null : sha256(requestText);
  if (suppliedRequestHash && derivedRequestHash && suppliedRequestHash !== derivedRequestHash) {
    fail('original_request.request_sha256 does not match the request UTF-8 bytes.');
  }
  return {
    type: value.type,
    clear: value.clear,
    authorized: value.authorized,
    specification_approved: value.specification_approved === true,
    approval_reference: value.approval_reference ?? null,
    request: requestText ?? null,
    request_sha256: suppliedRequestHash ?? derivedRequestHash,
  };
}

function normalizeIdList(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  const result = value.map((entry, index) => meaningfulString(entry, `${path}[${index}]`, 256));
  const sorted = [...result].sort(compareStrings);
  if (!result.every((entry, index) => entry === sorted[index])) {
    fail(`${path} must be sorted.`);
  }
  if (new Set(result).size !== result.length) fail(`${path} must not contain duplicates.`);
  return result;
}

function normalizeSnapshotState(value, path) {
  if (value === undefined) return null;
  exactKeys(
    value,
    path,
    new Set([
      'fog_empty',
      'unresolved_children',
      'blocked_children',
      'claimed_children',
      'pending_children',
      'map_clear',
    ]),
    [
      'fog_empty',
      'unresolved_children',
      'blocked_children',
      'claimed_children',
      'pending_children',
      'map_clear',
    ],
  );
  for (const key of ['fog_empty', 'map_clear']) {
    if (typeof value[key] !== 'boolean') fail(`${path}.${key} must be a boolean.`);
  }
  return {
    fog_empty: value.fog_empty,
    unresolved_children: normalizeIdList(value.unresolved_children, `${path}.unresolved_children`),
    blocked_children: normalizeIdList(value.blocked_children, `${path}.blocked_children`),
    claimed_children: normalizeIdList(value.claimed_children, `${path}.claimed_children`),
    pending_children: normalizeIdList(value.pending_children, `${path}.pending_children`),
    map_clear: value.map_clear,
  };
}

function normalizeSnapshot(value, index) {
  exactKeys(
    value,
    `frontier_snapshots[${index}]`,
    new Set([
      'sequence',
      'revision',
      'map_revision',
      'frontier_revision',
      'frontier',
      'recomputed',
      'state',
    ]),
    ['sequence', 'revision', 'frontier'],
  );
  const sequence = nonNegativeInteger(value.sequence, `frontier_snapshots[${index}].sequence`);
  const revision = positiveInteger(value.revision, `frontier_snapshots[${index}].revision`);
  const mapRevision = value.map_revision === undefined
    ? revision
    : positiveInteger(value.map_revision, `frontier_snapshots[${index}].map_revision`);
  const frontierRevision = value.frontier_revision === undefined
    ? revision
    : positiveInteger(
      value.frontier_revision,
      `frontier_snapshots[${index}].frontier_revision`,
    );
  if (!Array.isArray(value.frontier)) fail(`frontier_snapshots[${index}].frontier must be an array.`);
  const frontier = normalizeIdList(value.frontier, `frontier_snapshots[${index}].frontier`);
  if (value.recomputed === false) fail(`frontier_snapshots[${index}] was not recomputed.`);
  return {
    sequence,
    revision,
    map_revision: mapRevision,
    frontier_revision: frontierRevision,
    frontier,
    recomputed: true,
    state: normalizeSnapshotState(value.state, `frontier_snapshots[${index}].state`),
  };
}

function normalizeClaim(value, cycleIndex) {
  exactKeys(
    value,
    `cycles[${cycleIndex}].claim`,
    new Set([
      'ticket_id',
      'token',
      'owner_id',
      'session_id',
      'acquired_revision',
      'acquired_at',
      'expires_at',
      'lifecycle',
    ]),
    [
      'ticket_id',
      'token',
      'owner_id',
      'session_id',
      'acquired_revision',
      'acquired_at',
      'expires_at',
      'lifecycle',
    ],
  );
  if (!Array.isArray(value.lifecycle) || value.lifecycle.some((entry) => typeof entry !== 'string')) {
    fail(`cycles[${cycleIndex}].claim.lifecycle must be an array of strings.`);
  }
  const acquiredAt = timestamp(value.acquired_at, `cycles[${cycleIndex}].claim.acquired_at`);
  const expiresAt = timestamp(value.expires_at, `cycles[${cycleIndex}].claim.expires_at`);
  if (parseTimestamp(expiresAt, `cycles[${cycleIndex}].claim.expires_at`)
      <= parseTimestamp(acquiredAt, `cycles[${cycleIndex}].claim.acquired_at`)) {
    fail(`cycles[${cycleIndex}].claim must expire after acquisition.`);
  }
  return {
    ticket_id: meaningfulString(value.ticket_id, `cycles[${cycleIndex}].claim.ticket_id`, 256),
    token: meaningfulString(value.token, `cycles[${cycleIndex}].claim.token`, 256),
    owner_id: meaningfulString(value.owner_id, `cycles[${cycleIndex}].claim.owner_id`, 256),
    session_id: meaningfulString(value.session_id, `cycles[${cycleIndex}].claim.session_id`, 256),
    acquired_revision: positiveInteger(
      value.acquired_revision,
      `cycles[${cycleIndex}].claim.acquired_revision`,
    ),
    acquired_at: acquiredAt,
    expires_at: expiresAt,
    lifecycle: [...value.lifecycle],
  };
}

function providerProvenance(value) {
  if (value === undefined || value === null) {
    return { marked: false, trusted: false, invalid: false };
  }
  if (typeof value === 'string') {
    return {
      marked: PROVIDER_MARKERS.has(value),
      trusted: false,
      invalid: PROVIDER_MARKERS.has(value),
    };
  }
  if (!isRecord(value)) return { marked: false, trusted: false, invalid: false };

  const markerValues = ['kind', 'type', 'source']
    .filter((key) => value[key] !== undefined)
    .map((key) => value[key]);
  const marked = markerValues.some((entry) => PROVIDER_MARKERS.has(entry));
  if (!marked) return { marked: false, trusted: false, invalid: false };

  let invalid = markerValues.some((entry) => typeof entry !== 'string')
    || new Set(markerValues).size > 1
    || Object.keys(value).some((key) => !PROVIDER_PROVENANCE_KEYS.has(key));
  const providerId = value.provider_id ?? value.provider;
  const providerAliases = [value.provider_id, value.provider]
    .filter((entry) => entry !== undefined);
  if (providerAliases.length > 1 && new Set(providerAliases).size > 1) invalid = true;
  const verifierId = value.verifier_id ?? value.verifier;
  const verifierAliases = [value.verifier_id, value.verifier]
    .filter((entry) => entry !== undefined);
  if (verifierAliases.length > 1 && new Set(verifierAliases).size > 1) invalid = true;
  const authSignals = [value.authenticated, value.verified]
    .filter((entry) => entry !== undefined);
  if (authSignals.some((entry) => entry !== true)) {
    invalid = true;
  }
  if (typeof providerId !== 'string' || providerId.trim().length === 0
      || byteLength(providerId) > 256) {
    invalid = true;
  }
  if (typeof verifierId !== 'string' || verifierId.trim().length === 0
      || byteLength(verifierId) > 256) {
    invalid = true;
  }
  const proofValues = [value.signature, value.verification_digest]
    .filter((entry) => entry !== undefined);
  if (proofValues.length === 0
      || proofValues.some((entry) => typeof entry !== 'string'
        || entry.trim().length === 0
        || byteLength(entry) > 1_024)) {
    invalid = true;
  }
  return { marked: true, trusted: !invalid, invalid };
}

function byteField(value, path) {
  return nonNegativeInteger(value, path);
}

function normalizeUsagePhase(value, path) {
  exactKeys(
    value,
    path,
    new Set([
      'time_ms',
      'token_units',
      'tool_calls',
      'input_bytes',
      'output_bytes',
      'input_utf8_bytes',
      'output_utf8_bytes',
      'input',
      'output',
      'provenance',
    ]),
    ['time_ms', 'tool_calls'],
  );
  const time = nonNegativeInteger(value.time_ms, `${path}.time_ms`);
  const toolCalls = nonNegativeInteger(value.tool_calls, `${path}.tool_calls`);
  const hasTokenUnits = value.token_units !== undefined;
  const tokenUnits = hasTokenUnits
    ? nonNegativeInteger(value.token_units, `${path}.token_units`)
    : null;
  const provenance = value.provenance;
  const inputStringBytes = typeof value.input === 'string' ? byteLength(value.input) : null;
  const outputStringBytes = typeof value.output === 'string' ? byteLength(value.output) : null;
  const hasStrings = inputStringBytes !== null || outputStringBytes !== null;
  const inputDeclarations = [value.input_bytes, value.input_utf8_bytes]
    .filter((entry) => entry !== undefined);
  const outputDeclarations = [value.output_bytes, value.output_utf8_bytes]
    .filter((entry) => entry !== undefined);
  const inputDeclaration = inputDeclarations[0];
  const outputDeclaration = outputDeclarations[0];
  let byteMismatch = inputDeclarations.length > 1
    && inputDeclarations.some((entry) => entry !== inputDeclaration);
  byteMismatch ||= outputDeclarations.length > 1
    && outputDeclarations.some((entry) => entry !== outputDeclaration);
  if (hasStrings && inputDeclaration !== undefined && inputDeclaration !== inputStringBytes) {
    byteMismatch = true;
  }
  if (hasStrings && outputDeclaration !== undefined && outputDeclaration !== outputStringBytes) {
    byteMismatch = true;
  }
  const inputBytesValue = inputDeclaration
    ?? (hasStrings ? (inputStringBytes ?? 0) : undefined);
  const outputBytesValue = outputDeclaration
    ?? (hasStrings ? (outputStringBytes ?? 0) : undefined);
  const hasBytes = inputBytesValue !== undefined || outputBytesValue !== undefined;
  let derivedTokenUnits = null;
  if (hasBytes) {
    if (inputBytesValue === undefined || outputBytesValue === undefined) {
      fail(`${path} requires both input and output UTF-8 byte counts.`);
    }
    const inputBytes = byteField(inputBytesValue, `${path}.input_bytes`);
    const outputBytes = byteField(outputBytesValue, `${path}.output_bytes`);
    const totalBytes = safeAdd(inputBytes, outputBytes);
    if (totalBytes === null) fail(`${path} byte counts overflow safe integer range.`);
    derivedTokenUnits = Math.ceil(totalBytes / 4);
  }
  const provider = providerProvenance(provenance);
  const trustedTelemetry = provider.trusted;
  const opaqueBytes = hasBytes && !hasStrings;
  if (opaqueBytes && !trustedTelemetry) {
    byteMismatch = true;
  }
  const tokenMismatch = !trustedTelemetry
    && hasTokenUnits
    && derivedTokenUnits !== null
    && tokenUnits !== derivedTokenUnits;
  if (!trustedTelemetry && hasStrings && derivedTokenUnits > 0 && tokenUnits === 0) {
    byteMismatch = true;
  }
  const trusted = (hasTokenUnits && trustedTelemetry)
    || (hasStrings && derivedTokenUnits !== null)
    || (opaqueBytes && trustedTelemetry);
  return {
    time_ms: time,
    token_units: trustedTelemetry && hasTokenUnits
      ? tokenUnits
      : (derivedTokenUnits ?? tokenUnits ?? 0),
    tool_calls: toolCalls,
    trusted,
    source: trustedTelemetry
      ? 'provider'
      : (derivedTokenUnits === null ? 'untrusted' : 'derived-bytes'),
    byte_mismatch: byteMismatch,
    byte_provenance_untrusted: opaqueBytes && !trustedTelemetry,
    token_mismatch: tokenMismatch,
    provider_provenance_invalid: provider.invalid,
  };
}

function normalizeUsage(value, cycleIndex) {
  exactKeys(
    value,
    `cycles[${cycleIndex}].usage`,
    new Set(['work', 'sync']),
    ['work', 'sync'],
  );
  return {
    work: normalizeUsagePhase(value.work, `cycles[${cycleIndex}].usage.work`),
    sync: normalizeUsagePhase(value.sync, `cycles[${cycleIndex}].usage.sync`),
  };
}

function normalizeTiming(value, cycleIndex) {
  exactKeys(
    value,
    `cycles[${cycleIndex}].timing`,
    new Set(['started_at', 'finished_at', 'elapsed_ms']),
    ['started_at', 'finished_at', 'elapsed_ms'],
  );
  const startedAt = timestamp(value.started_at, `cycles[${cycleIndex}].timing.started_at`);
  const finishedAt = timestamp(value.finished_at, `cycles[${cycleIndex}].timing.finished_at`);
  const started = parseTimestamp(startedAt, `cycles[${cycleIndex}].timing.started_at`);
  const finished = parseTimestamp(finishedAt, `cycles[${cycleIndex}].timing.finished_at`);
  const elapsed = nonNegativeInteger(value.elapsed_ms, `cycles[${cycleIndex}].timing.elapsed_ms`);
  if (finished < started || finished - started !== elapsed) {
    fail(`cycles[${cycleIndex}].timing.elapsed_ms must match its timestamps.`);
  }
  return { started_at: startedAt, finished_at: finishedAt, elapsed_ms: elapsed };
}

function normalizeWorkerOperations(value, cycleIndex) {
  if (!Array.isArray(value)) fail(`cycles[${cycleIndex}].worker_operations must be an array.`);
  if (value.length > AUTONOMY_DEFAULTS.maxWorkers) {
    fail(`cycles[${cycleIndex}].worker_operations exceeds the bounded worker limit.`);
  }
  return value.map((operation, operationIndex) => {
    exactKeys(
      operation,
      `cycles[${cycleIndex}].worker_operations[${operationIndex}]`,
      new Set([
        'worker_id',
        'controller_id',
        'ticket_id',
        'mode',
        'operation',
        'sequence',
        'operation_index',
        'started_at',
        'finished_at',
      ]),
      [
        'worker_id',
        'controller_id',
        'ticket_id',
        'mode',
        'operation',
        'sequence',
      ],
    );
    const hasOperationIndex = operation.operation_index !== undefined;
    const hasStartedAt = operation.started_at !== undefined;
    const hasFinishedAt = operation.finished_at !== undefined;
    if (!hasOperationIndex) {
      fail(
        `cycles[${cycleIndex}].worker_operations[${operationIndex}] requires operation_index.`,
      );
    }
    if (hasStartedAt !== hasFinishedAt) {
      fail(
        `cycles[${cycleIndex}].worker_operations[${operationIndex}] requires both worker timestamps.`,
      );
    }
    return {
      worker_id: meaningfulString(
        operation.worker_id,
        `cycles[${cycleIndex}].worker_operations[${operationIndex}].worker_id`,
        256,
      ),
      controller_id: meaningfulString(
        operation.controller_id,
        `cycles[${cycleIndex}].worker_operations[${operationIndex}].controller_id`,
        256,
      ),
      ticket_id: meaningfulString(
        operation.ticket_id,
        `cycles[${cycleIndex}].worker_operations[${operationIndex}].ticket_id`,
        256,
      ),
      mode: meaningfulString(
        operation.mode,
        `cycles[${cycleIndex}].worker_operations[${operationIndex}].mode`,
        256,
      ),
      operation: meaningfulString(
        operation.operation,
        `cycles[${cycleIndex}].worker_operations[${operationIndex}].operation`,
        256,
      ).toLowerCase(),
      sequence: nonNegativeInteger(
        operation.sequence,
        `cycles[${cycleIndex}].worker_operations[${operationIndex}].sequence`,
      ),
      operation_index: nonNegativeInteger(
        operation.operation_index,
        `cycles[${cycleIndex}].worker_operations[${operationIndex}].operation_index`,
      ),
      started_at: operation.started_at === undefined
        ? null
        : timestamp(
          operation.started_at,
          `cycles[${cycleIndex}].worker_operations[${operationIndex}].started_at`,
        ),
      finished_at: operation.finished_at === undefined
        ? null
        : timestamp(
          operation.finished_at,
          `cycles[${cycleIndex}].worker_operations[${operationIndex}].finished_at`,
        ),
    };
  });
}

function normalizeDispatches(value, cycleIndex) {
  exactKeys(
    value,
    `cycles[${cycleIndex}].dispatched_operations`,
    new Set(['work', 'sync']),
    ['work', 'sync'],
  );
  const result = {};
  for (const kind of ['work', 'sync']) {
    if (!Array.isArray(value[kind])) {
      fail(`cycles[${cycleIndex}].dispatched_operations.${kind} must be an array.`);
    }
    result[kind] = value[kind].map((operation, index) =>
      meaningfulString(
        operation,
        `cycles[${cycleIndex}].dispatched_operations.${kind}[${index}]`,
        256,
      ).toLowerCase());
  }
  return result;
}

function normalizeReceipts(value, cycleIndex) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`cycles[${cycleIndex}].receipts must be an array.`);
  return value.map((receipt, receiptIndex) => {
    exactKeys(
      receipt,
      `cycles[${cycleIndex}].receipts[${receiptIndex}]`,
      new Set(['ticket_id', 'revision']),
      ['ticket_id', 'revision'],
    );
    return {
      ticket_id: meaningfulString(
        receipt.ticket_id,
        `cycles[${cycleIndex}].receipts[${receiptIndex}].ticket_id`,
        256,
      ),
      revision: positiveInteger(
        receipt.revision,
        `cycles[${cycleIndex}].receipts[${receiptIndex}].revision`,
      ),
    };
  });
}

function normalizeCycle(value, index) {
  exactKeys(
    value,
    `cycles[${index}]`,
    new Set([
      'cycle',
      'snapshot_sequence',
      'selected_ticket',
      'claim',
      'worker_operations',
      'operations',
      'dispatched_operations',
      'receipts',
      'timing',
      'outcome',
      'committed',
      'usage',
    ]),
    [
      'cycle',
      'snapshot_sequence',
      'selected_ticket',
      'claim',
      'worker_operations',
      'operations',
      'dispatched_operations',
      'timing',
      'outcome',
      'usage',
    ],
  );
  if (!Array.isArray(value.operations)
      || value.operations.some((operation) => typeof operation !== 'string')) {
    fail(`cycles[${index}].operations must be an array of strings.`);
  }
  if (value.operations.length > AUTONOMY_DEFAULTS.maxOperations) {
    fail(`cycles[${index}].operations exceeds the bounded operation limit.`);
  }
  if (!OUTCOMES.has(value.outcome)) fail(`cycles[${index}].outcome is unsupported.`);
  let committed = null;
  if (value.committed !== undefined) {
    exactKeys(
      value.committed,
      `cycles[${index}].committed`,
      new Set(['ticket_id', 'revision']),
      ['ticket_id', 'revision'],
    );
    committed = {
      ticket_id: meaningfulString(
        value.committed.ticket_id,
        `cycles[${index}].committed.ticket_id`,
        256,
      ),
      revision: positiveInteger(value.committed.revision, `cycles[${index}].committed.revision`),
    };
  }
  return {
    cycle: positiveInteger(value.cycle, `cycles[${index}].cycle`),
    snapshot_sequence: nonNegativeInteger(
      value.snapshot_sequence,
      `cycles[${index}].snapshot_sequence`,
    ),
    selected_ticket: meaningfulString(
      value.selected_ticket,
      `cycles[${index}].selected_ticket`,
      256,
    ),
    claim: normalizeClaim(value.claim, index),
    worker_operations: normalizeWorkerOperations(value.worker_operations, index),
    operations: value.operations.map((operation) => operation.toLowerCase()),
    dispatched_operations: normalizeDispatches(value.dispatched_operations, index),
    receipts: normalizeReceipts(value.receipts, index),
    timing: normalizeTiming(value.timing, index),
    outcome: value.outcome,
    committed,
    usage: normalizeUsage(value.usage, index),
  };
}

function normalizeEvidence(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return meaningfulString(value, path, 1_024);
  exactKeys(value, path, new Set(['reference', 'summary']), ['reference', 'summary']);
  return {
    reference: meaningfulString(value.reference, `${path}.reference`, 256),
    summary: meaningfulString(value.summary, `${path}.summary`, 1_024),
  };
}

function normalizeCheckpoint(value) {
  if (value === undefined || value === null) return null;
  exactKeys(
    value,
    'stop.checkpoint',
    new Set([
      'invocation_id',
      'map_id',
      'map_revision',
      'frontier_revision',
      'claim',
      'completed_count',
      'completed_digest',
      'cumulative_digest',
      'recent_completed',
      'usage',
      'remaining_budget',
      'stop_reason',
    ]),
    [
      'invocation_id',
      'map_id',
      'map_revision',
      'frontier_revision',
      'claim',
      'completed_count',
      'usage',
      'remaining_budget',
      'stop_reason',
    ],
  );
  const claim = value.claim;
  let normalizedClaim = null;
  if (claim !== null) {
    exactKeys(
      claim,
      'stop.checkpoint.claim',
      new Set(['ticket_id', 'token', 'owner_id', 'session_id', 'acquired_revision']),
      ['ticket_id', 'token', 'owner_id', 'session_id', 'acquired_revision'],
    );
    normalizedClaim = {
      ticket_id: meaningfulString(claim.ticket_id, 'stop.checkpoint.claim.ticket_id', 256),
      token: meaningfulString(claim.token, 'stop.checkpoint.claim.token', 256),
      owner_id: meaningfulString(claim.owner_id, 'stop.checkpoint.claim.owner_id', 256),
      session_id: meaningfulString(claim.session_id, 'stop.checkpoint.claim.session_id', 256),
      acquired_revision: positiveInteger(
        claim.acquired_revision,
        'stop.checkpoint.claim.acquired_revision',
      ),
    };
  }
  const completedCount = nonNegativeInteger(
    value.completed_count,
    'stop.checkpoint.completed_count',
  );
  if (value.completed_digest === undefined && value.cumulative_digest === undefined) {
    fail('stop.checkpoint.completed_digest is required.');
  }
  if (value.completed_digest !== undefined && value.cumulative_digest !== undefined
      && value.completed_digest !== value.cumulative_digest) {
    fail('stop.checkpoint.completed_digest and cumulative_digest must match.');
  }
  const completedDigest = validSha256(
    value.completed_digest ?? value.cumulative_digest,
    'stop.checkpoint.completed_digest',
  );
  let recentCompleted = [];
  if (value.recent_completed !== undefined) {
    if (!Array.isArray(value.recent_completed)
        || value.recent_completed.length > AUTONOMY_DEFAULTS.maxRecentCompleted) {
      fail(
        `stop.checkpoint.recent_completed must contain at most `
        + `${AUTONOMY_DEFAULTS.maxRecentCompleted} entries.`,
      );
    }
    recentCompleted = value.recent_completed.map((entry, index) => {
    exactKeys(
      entry,
      `stop.checkpoint.recent_completed[${index}]`,
      new Set(['ticket_id', 'revision']),
      ['ticket_id', 'revision'],
    );
    return {
      ticket_id: meaningfulString(
        entry.ticket_id,
        `stop.checkpoint.recent_completed[${index}].ticket_id`,
        256,
      ),
      revision: positiveInteger(
        entry.revision,
        `stop.checkpoint.recent_completed[${index}].revision`,
      ),
    };
    });
  }
  function checkpointUsage(entry, path) {
    exactKeys(entry, path, new Set(['time_ms', 'token_units', 'tool_calls']), [
      'time_ms',
      'token_units',
      'tool_calls',
    ]);
    return {
      time_ms: nonNegativeInteger(entry.time_ms, `${path}.time_ms`),
      token_units: nonNegativeInteger(entry.token_units, `${path}.token_units`),
      tool_calls: nonNegativeInteger(entry.tool_calls, `${path}.tool_calls`),
    };
  }
  return {
    invocation_id: meaningfulString(value.invocation_id, 'stop.checkpoint.invocation_id'),
    map_id: meaningfulString(value.map_id, 'stop.checkpoint.map_id'),
    map_revision: positiveInteger(value.map_revision, 'stop.checkpoint.map_revision'),
    frontier_revision: positiveInteger(
      value.frontier_revision,
      'stop.checkpoint.frontier_revision',
    ),
    claim: normalizedClaim,
    completed_count: completedCount,
    completed_digest: completedDigest,
    recent_completed: recentCompleted,
    usage: checkpointUsage(value.usage, 'stop.checkpoint.usage'),
    remaining_budget: checkpointUsage(
      value.remaining_budget,
      'stop.checkpoint.remaining_budget',
    ),
    stop_reason: meaningfulString(value.stop_reason, 'stop.checkpoint.stop_reason', 256),
  };
}

function normalizeStop(value) {
  exactKeys(
    value,
    'stop',
    new Set(['reason', 'substantive', 'safe_checkpoint', 'checkpoint', 'flags', 'evidence']),
    ['reason', 'substantive'],
  );
  meaningfulString(value.reason, 'stop.reason', 256);
  if (value.substantive !== undefined && typeof value.substantive !== 'boolean') {
    fail('stop.substantive must be a boolean.');
  }
  if (value.safe_checkpoint !== undefined && typeof value.safe_checkpoint !== 'boolean') {
    fail('stop.safe_checkpoint must be a boolean.');
  }
  const flags = value.flags ?? {};
  exactKeys(flags, 'stop.flags', new Set([
    'human_grilling',
    'authorization',
    'policy_input',
    'ambiguous_scope',
    'safety_failure',
    'recovery_failure',
  ]));
  for (const [key, flag] of Object.entries(flags)) {
    if (typeof flag !== 'boolean') fail(`stop.flags.${key} must be a boolean.`);
  }
  return {
    reason: value.reason,
    substantive: value.substantive === true,
    safe_checkpoint: value.safe_checkpoint === true,
    checkpoint: normalizeCheckpoint(value.checkpoint),
    flags,
    evidence: normalizeEvidence(value.evidence, 'stop.evidence'),
  };
}

function normalizeHandoff(value) {
  if (value === null || value === undefined) return null;
  exactKeys(
    value,
    'handoff',
    new Set([
      'target',
      'authorized_by',
      'specification_approved',
      'approval_id',
      'approval_digest',
      'verifier_id',
    ]),
    ['target', 'authorized_by'],
  );
  if (value.specification_approved !== undefined
      && typeof value.specification_approved !== 'boolean') {
    fail('handoff.specification_approved must be a boolean.');
  }
  return {
    target: meaningfulString(value.target, 'handoff.target', 256),
    authorized_by: meaningfulString(value.authorized_by, 'handoff.authorized_by', 256),
    specification_approved: value.specification_approved === true,
    approval_id: value.approval_id === undefined
      ? null
      : meaningfulString(value.approval_id, 'handoff.approval_id', 256),
    approval_digest: value.approval_digest === undefined
      ? null
      : validSha256(value.approval_digest, 'handoff.approval_digest'),
    verifier_id: value.verifier_id === undefined
      ? null
      : meaningfulString(value.verifier_id, 'handoff.verifier_id', 256),
  };
}

function normalizeTrustedApproval(value) {
  if (value === undefined || value === null) return null;
  exactKeys(
    value,
    'trusted_approval',
    new Set([
      'approval_id',
      'original_request_sha256',
      'request_sha256',
      'actor_id',
      'actor',
      'allowed_handoff',
      'issued_at',
      'expires_at',
      'verifier_id',
      'verifier',
      'signature',
      'verification_digest',
    ]),
    [
      'approval_id',
      'allowed_handoff',
      'issued_at',
      'expires_at',
    ],
  );
  if (value.original_request_sha256 === undefined && value.request_sha256 === undefined) {
    fail('trusted_approval.original_request_sha256 is required.');
  }
  if (value.actor_id === undefined && value.actor === undefined) {
    fail('trusted_approval.actor_id is required.');
  }
  if (value.verifier_id === undefined && value.verifier === undefined) {
    fail('trusted_approval.verifier_id is required.');
  }
  const requestHashes = [value.original_request_sha256, value.request_sha256]
    .filter((entry) => entry !== undefined);
  if (requestHashes.length > 1 && requestHashes[0] !== requestHashes[1]) {
    fail('trusted_approval request hash aliases must match.');
  }
  const actorValues = [value.actor_id, value.actor].filter((entry) => entry !== undefined);
  if (actorValues.length > 1 && actorValues[0] !== actorValues[1]) {
    fail('trusted_approval actor aliases must match.');
  }
  const verifierValues = [value.verifier_id, value.verifier]
    .filter((entry) => entry !== undefined);
  if (verifierValues.length > 1 && verifierValues[0] !== verifierValues[1]) {
    fail('trusted_approval verifier aliases must match.');
  }
  const issuedAt = timestamp(value.issued_at, 'trusted_approval.issued_at');
  const expiresAt = timestamp(value.expires_at, 'trusted_approval.expires_at');
  if (parseTimestamp(expiresAt, 'trusted_approval.expires_at')
      <= parseTimestamp(issuedAt, 'trusted_approval.issued_at')) {
    fail('trusted_approval must expire after issuance.');
  }
  const signature = value.signature === undefined
    ? null
    : meaningfulString(value.signature, 'trusted_approval.signature', 1_024);
  const verificationDigest = value.verification_digest === undefined
    ? null
    : meaningfulString(value.verification_digest, 'trusted_approval.verification_digest', 256);
  if (!signature && !verificationDigest) {
    fail('trusted_approval requires a verifier signature or verification digest.');
  }
  return {
    approval_id: meaningfulString(value.approval_id, 'trusted_approval.approval_id', 256),
    original_request_sha256: validSha256(
      requestHashes[0],
      'trusted_approval.original_request_sha256',
    ),
    actor_id: meaningfulString(
      actorValues[0],
      'trusted_approval.actor_id',
      256,
    ),
    allowed_handoff: meaningfulString(
      value.allowed_handoff,
      'trusted_approval.allowed_handoff',
      256,
    ),
    issued_at: issuedAt,
    expires_at: expiresAt,
    verifier_id: meaningfulString(
      verifierValues[0],
      'trusted_approval.verifier_id',
      256,
    ),
    signature,
    verification_digest: verificationDigest,
  };
}

function containsBudgetOverride(value) {
  if (Array.isArray(value)) return value.some(containsBudgetOverride);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    ['budget', 'budgets', 'hard_budget', 'reserve'].includes(key.toLowerCase())
      || containsBudgetOverride(child));
}

function containsTrustedApproval(value) {
  if (Array.isArray(value)) return value.some(containsTrustedApproval);
  if (!isRecord(value)) return false;
  const keys = new Set(Object.keys(value).map((key) => key.toLowerCase()));
  if (keys.has('trusted_approval') || keys.has('approval_record')) return true;
  if (keys.has('approval_id')
      && (keys.has('actor_id') || keys.has('actor'))
      && (keys.has('allowed_handoff') || keys.has('original_request_sha256'))) {
    return true;
  }
  return Object.values(value).some(containsTrustedApproval);
}

function approvalDigests(approval) {
  const required = {
    actor_id: approval.actor_id,
    allowed_handoff: approval.allowed_handoff,
    approval_id: approval.approval_id,
    expires_at: approval.expires_at,
    issued_at: approval.issued_at,
    original_request_sha256: approval.original_request_sha256,
    verifier_id: approval.verifier_id,
    verification_digest: approval.verification_digest,
  };
  const digests = [
    sha256(JSON.stringify({ ...required, signature: approval.signature })),
  ];
  if (approval.signature === null) digests.push(sha256(JSON.stringify(required)));
  return digests;
}

function trustedHumanIdentity(value, controllerId) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === controllerId.trim().toLowerCase()) return false;
  return !/(^|[-_:/. ])(?:controller|self|agent|tracker|system|bot)(?:$|[-_:/. ])/.test(
    normalized,
  );
}

function normalizeInput(input) {
  if (!isRecord(input)) fail('input must be one JSON object.');
  const canonical = canonicalValue(input);
  if (serializedSize(canonical) > AUTONOMY_DEFAULTS.inputBytes) {
    fail(`input must not exceed ${AUTONOMY_DEFAULTS.inputBytes} serialized UTF-8 bytes.`);
  }
  exactKeys(
    canonical,
    'input',
    new Set([
      'schemaVersion',
      'invocation',
      'original_request',
      'frontier_snapshots',
      'cycles',
      'stop',
      'handoff',
      'trusted_approval',
      'tracker_content',
    ]),
    [
      'schemaVersion',
      'invocation',
      'original_request',
      'frontier_snapshots',
      'cycles',
      'stop',
    ],
  );
  if (canonical.schemaVersion !== SCHEMA_VERSION) {
    fail(`schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(canonical.frontier_snapshots)) {
    fail('frontier_snapshots must be an array.');
  }
  if (!Array.isArray(canonical.cycles)) fail('cycles must be an array.');
  if (canonical.tracker_content !== undefined
      && containsBudgetOverride(canonical.tracker_content)) {
    fail('tracker_content cannot contain budget overrides.');
  }
  if (canonical.tracker_content !== undefined
      && containsTrustedApproval(canonical.tracker_content)) {
    fail('trusted approval records must be injected outside tracker_content.');
  }
  return {
    schemaVersion: canonical.schemaVersion,
    invocation: normalizeInvocation(canonical.invocation),
    original_request: normalizeOriginalRequest(canonical.original_request),
    frontier_snapshots: canonical.frontier_snapshots.map(normalizeSnapshot),
    cycles: canonical.cycles.map(normalizeCycle),
    stop: normalizeStop(canonical.stop),
    handoff: normalizeHandoff(canonical.handoff),
    trusted_approval: normalizeTrustedApproval(canonical.trusted_approval),
  };
}

function equalSequence(actual, expected) {
  return actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

function checkBudget(normalized, violations) {
  const { hard, reserve } = normalized.invocation.budget;
  const minimum = AUTONOMY_DEFAULTS.minimumReserve;
  for (const key of Object.keys(minimum)) {
    if (reserve[key] < minimum[key] || hard[key] < reserve[key]) {
      addViolation(violations, 'budget-insufficient-for-safe-sync');
    }
  }
  if (normalized.cycles.length > 0
      && Object.keys(hard).some((key) => hard[key] <= reserve[key])) {
    addViolation(violations, 'budget-insufficient-for-safe-sync');
  }
}

function checkSnapshots(normalized, violations) {
  const { frontier_snapshots: snapshots, cycles } = normalized;
  if (snapshots.length !== cycles.length + 1) {
    addViolation(violations, 'frontier-recomputation-missing');
  }
  snapshots.forEach((snapshot, index) => {
    if (snapshot.sequence !== index) addViolation(violations, 'snapshot-order');
    if (index > 0 && snapshot.revision <= snapshots[index - 1].revision) {
      addViolation(violations, 'stale-frontier');
    }
    if (snapshot.map_revision < snapshot.revision
        || snapshot.frontier_revision < snapshot.revision
        || (index > 0 && snapshot.map_revision <= snapshots[index - 1].map_revision)
        || (index > 0
          && snapshot.frontier_revision <= snapshots[index - 1].frontier_revision)) {
      addViolation(violations, 'stale-frontier');
    }
    if (!snapshot.state) {
      addViolation(violations, 'frontier-state-missing');
    } else {
      const stateClear = snapshot.state.fog_empty
        && snapshot.state.unresolved_children.length === 0
        && snapshot.state.blocked_children.length === 0
        && snapshot.state.claimed_children.length === 0
        && snapshot.state.pending_children.length === 0;
      const unresolved = new Set(snapshot.state.unresolved_children);
      for (const childId of [
        ...snapshot.state.blocked_children,
        ...snapshot.state.claimed_children,
        ...snapshot.state.pending_children,
      ]) {
        if (!unresolved.has(childId)) addViolation(violations, 'frontier-state-mismatch');
      }
      const eligible = snapshot.state.unresolved_children.filter((ticketId) =>
        !snapshot.state.blocked_children.includes(ticketId)
        && !snapshot.state.claimed_children.includes(ticketId)
        && !snapshot.state.pending_children.includes(ticketId));
      if (snapshot.state.map_clear !== stateClear
          || !equalSequence(snapshot.frontier, eligible)) {
        addViolation(violations, 'frontier-state-mismatch');
      }
    }
  });
}

function checkWorkerOperations(cycle, normalized, violations) {
  let previousSequence = -1;
  let previousOperationIndex = -1;
  const inspectIndex = cycle.operations.indexOf('inspect');
  const consolidationIndex = cycle.operations.indexOf('consolidate-workers');
  const synchronizationIndex = cycle.operations.findIndex((operation) =>
    ['synchronize', 'release'].includes(operation));
  const workDispatches = cycle.dispatched_operations.work;
  const claimDispatchIndex = workDispatches.indexOf('claim');
  const inspectDispatchIndex = workDispatches.indexOf('inspect');
  const workerDispatchCursor = new Map();
  for (const [workerIndex, operation] of cycle.worker_operations.entries()) {
    if (operation.controller_id !== normalized.invocation.owner_id
        || operation.ticket_id !== cycle.selected_ticket) {
      addViolation(violations, 'worker-association-conflict');
    }
    if (operation.mode !== 'read-only-research') {
      addViolation(violations, 'worker-mode-forbidden');
    }
    const normalizedOperation = operation.operation.toLowerCase();
    if (!WORKER_OPERATIONS.has(normalizedOperation)) {
      addViolation(
        violations,
        FORBIDDEN_WORKER_OPERATIONS.has(normalizedOperation)
          ? 'worker-operation-forbidden'
          : 'worker-operation-unknown',
      );
    }
    if (operation.sequence !== workerIndex || operation.sequence <= previousSequence) {
      addViolation(violations, 'worker-event-sequence');
    }
    previousSequence = operation.sequence;
    if (operation.operation_index <= previousOperationIndex
        || inspectIndex < 0
        || operation.operation_index <= inspectIndex
        || synchronizationIndex < 0
        || operation.operation_index >= synchronizationIndex
        || (consolidationIndex >= 0 && operation.operation_index >= consolidationIndex)) {
      addViolation(violations, 'worker-event-order');
    }
    previousOperationIndex = operation.operation_index;
    const workerName = `worker:${operation.operation}`;
    const priorWorkerDispatches = workerDispatchCursor.get(workerName) ?? 0;
    let seenWorkerDispatches = 0;
    let dispatchIndex = -1;
    for (const [index, dispatch] of workDispatches.entries()) {
      if (dispatch !== workerName) continue;
      if (seenWorkerDispatches === priorWorkerDispatches) {
        dispatchIndex = index;
        break;
      }
      seenWorkerDispatches += 1;
    }
    workerDispatchCursor.set(workerName, priorWorkerDispatches + 1);
    if (claimDispatchIndex < 0
        || inspectDispatchIndex < 0
        || dispatchIndex <= claimDispatchIndex
        || dispatchIndex <= inspectDispatchIndex) {
      addViolation(violations, 'worker-event-order');
    }
  }
}

function checkControllerOperations(cycle, violations) {
  const operations = cycle.operations;
  for (const operation of operations) {
    if (FORBIDDEN_OPERATIONS.has(operation)) {
      addViolation(violations, 'controller-operation-forbidden');
    } else if (!CONTROLLER_OPERATIONS.has(operation)) {
      addViolation(violations, 'operation-unknown');
    }
  }
  const claimCount = operations.filter((operation) => operation === 'claim').length;
  if (claimCount !== 1) addViolation(violations, 'duplicate-claim');
  const claimIndex = operations.indexOf('claim');
  for (const operation of [
    'inspect',
    'research',
    'resolve',
    'work',
    'consolidate-workers',
    'synchronize',
    'close',
    'verify-close',
    'release',
    'verify-release',
    'recompute-frontier',
  ]) {
    const first = operations.indexOf(operation);
    if (first >= 0 && first < claimIndex) addViolation(violations, 'pre-claim-mutation');
  }
  if (cycle.outcome === 'succeeded') {
    const prefix = ['read-frontier', 'select', 'claim', 'inspect'];
    const suffix = ['synchronize', 'close', 'verify-close', 'recompute-frontier'];
    if (!equalSequence(operations.slice(0, prefix.length), prefix)
        || !equalSequence(operations.slice(-suffix.length), suffix)) {
      addViolation(violations, 'cycle-order');
      return;
    }
    const middle = operations.slice(prefix.length, -suffix.length);
    if (middle.length === 0
        || middle.some((operation) =>
          !['research', 'resolve', 'work', 'consolidate-workers'].includes(operation))) {
      addViolation(violations, 'cycle-order');
    }
    if (operations.filter((operation) => operation === 'synchronize').length !== 1
        || operations.filter((operation) => operation === 'close').length !== 1
        || operations.filter((operation) => operation === 'verify-close').length !== 1
        || operations.filter((operation) => operation === 'recompute-frontier').length !== 1) {
      addViolation(violations, 'duplicate-synchronization');
    }
  } else {
    const prefix = ['read-frontier', 'select', 'claim', 'inspect'];
    const releaseIndex = operations.indexOf('release');
    const suffix = ['release', 'verify-release', 'recompute-frontier'];
    const middle = releaseIndex >= prefix.length
      ? operations.slice(prefix.length, releaseIndex)
      : [];
    const validMiddle = middle.every((operation) => [
      'inspect',
      'research',
      'resolve',
      'work',
      'consolidate-workers',
    ].includes(operation));
    const uniqueMiddle = new Set(middle).size === middle.length;
    if (!equalSequence(operations.slice(0, prefix.length), prefix)
        || releaseIndex < prefix.length
        || !equalSequence(operations.slice(-suffix.length), suffix)
        || !validMiddle
        || !uniqueMiddle
        || operations.filter((operation) => operation === 'release').length !== 1
        || operations.filter((operation) => operation === 'verify-release').length !== 1
        || operations.filter((operation) => operation === 'recompute-frontier').length !== 1) {
      addViolation(violations, 'cycle-order');
    }
  }
}

function checkDispatchBinding(cycle, violations) {
  for (const kind of ['work', 'sync']) {
    const controllerDispatches = cycle.dispatched_operations[kind]
      .filter((operation) => !operation.startsWith('worker:'));
    const expectedControllerDispatches = cycle.operations.filter((operation) =>
      dispatchPhase(operation) === kind);
    if (!equalSequence(controllerDispatches, expectedControllerDispatches)) {
      addViolation(violations, 'dispatch-sequence-mismatch');
    }
    const workerDispatches = cycle.dispatched_operations[kind]
      .filter((operation) => operation.startsWith('worker:'));
    const expectedWorkerDispatches = kind === 'work'
      ? cycle.worker_operations.map((operation) => `worker:${operation.operation}`)
      : [];
    if (!equalSequence(workerDispatches, expectedWorkerDispatches)) {
      addViolation(violations, 'dispatch-sequence-mismatch');
    }
  }
}

function checkClaim(cycle, index, normalized, seenClaims, violations) {
  const claim = cycle.claim;
  if (seenClaims.has(claim.token)) addViolation(violations, 'double-claim');
  seenClaims.add(claim.token);
  if (claim.ticket_id !== cycle.selected_ticket) {
    addViolation(violations, 'claim-ticket-mismatch');
  }
  if (claim.owner_id !== normalized.invocation.owner_id
      || claim.session_id !== normalized.invocation.session_id) {
    addViolation(violations, 'claim-owner-conflict');
  }
  if (claim.lifecycle[0] !== 'acquired' || !claim.lifecycle.includes('inspected')) {
    addViolation(violations, 'claim-lifecycle');
  }
  const expected = cycle.outcome === 'succeeded'
    ? CLAIM_SUCCESS_LIFECYCLE
    : CLAIM_STOP_LIFECYCLE;
  if (!equalSequence(claim.lifecycle, expected)) addViolation(violations, 'claim-lifecycle');
  if (index > 0
      && claim.acquired_revision <= normalized.cycles[index - 1].claim.acquired_revision) {
    addViolation(violations, 'claim-order');
  }
}

function dispatchPhase(operation) {
  if (operation.startsWith('worker:')) return 'work';
  if (WORK_DISPATCH_OPERATIONS.has(operation)) return 'work';
  if (SYNC_DISPATCH_OPERATIONS.has(operation)) return 'sync';
  return null;
}

function validateDispatch(operation, kind, cycle, consumed, violations) {
  const phase = dispatchPhase(operation);
  if (phase === null) {
    addViolation(violations, 'dispatch-operation-unknown');
    return false;
  }
  if (phase !== kind) {
    addViolation(violations, 'dispatch-phase-mismatch');
    return false;
  }
  if (operation.startsWith('worker:')) {
    const workerOperation = operation.slice('worker:'.length);
    if (!WORKER_OPERATIONS.has(workerOperation)
        || !cycle.worker_operations.some((entry) => entry.operation === workerOperation)) {
      addViolation(violations, 'dispatch-operation-unknown');
      return false;
    }
  }
  const available = operation.startsWith('worker:')
    ? cycle.worker_operations.filter((entry) =>
      `worker:${entry.operation}` === operation).length
    : cycle.operations.filter((entry) => entry === operation).length;
  const used = consumed.get(operation) ?? 0;
  if (used >= available) {
    addViolation(violations, 'dispatch-operation-unvalidated');
    return false;
  }
  consumed.set(operation, used + 1);
  return true;
}

function chargedCycleUsage(cycle, violations) {
  const phaseTime = safeAdd(cycle.usage.work.time_ms, cycle.usage.sync.time_ms);
  if (phaseTime === null) {
    addViolation(violations, 'usage-overflow');
  } else if (phaseTime < cycle.timing.elapsed_ms) {
    addViolation(violations, 'elapsed-undercharge');
    addViolation(violations, 'elapsed-mismatch');
  }
  const chargedTime = phaseTime === null
    ? cycle.timing.elapsed_ms
    : Math.max(phaseTime, cycle.timing.elapsed_ms);
  const charged = { time_ms: chargedTime, token_units: 0, tool_calls: 0 };
  for (const kind of ['work', 'sync']) {
    for (const key of ['token_units', 'tool_calls']) {
      const next = safeAdd(charged[key], cycle.usage[kind][key]);
      if (next === null) {
        addViolation(violations, 'usage-overflow');
      } else {
        charged[key] = next;
      }
    }
  }
  return charged;
}

function completedDigest(entries) {
  return sha256(JSON.stringify(entries));
}

function addUsage(total, phase, violations) {
  for (const key of Object.keys(total)) {
    const next = safeAdd(total[key], phase[key]);
    if (next === null) {
      addViolation(violations, 'usage-overflow');
    } else {
      total[key] = next;
    }
  }
}

function checkUsage(cycle, totalUsage, workUsage, violations) {
  for (const kind of ['work', 'sync']) {
    if (!cycle.usage[kind].trusted) addViolation(violations, 'usage-untrusted');
    if (cycle.usage[kind].byte_mismatch) addViolation(violations, 'byte-count-mismatch');
    if (cycle.usage[kind].byte_provenance_untrusted) {
      addViolation(violations, 'byte-provenance-untrusted');
    }
    if (cycle.usage[kind].token_mismatch) {
      addViolation(violations, 'token-count-mismatch');
    }
    if (cycle.usage[kind].provider_provenance_invalid) {
      addViolation(violations, 'provider-provenance-invalid');
    }
    const dispatches = cycle.dispatched_operations[kind];
    const consumed = new Map();
    const dispatchesValid = dispatches.every((operation) =>
      validateDispatch(operation, kind, cycle, consumed, violations));
    if (dispatches.length !== cycle.usage[kind].tool_calls || !dispatchesValid) {
      addViolation(violations, 'tool-call-count-mismatch');
    }
  }
  addUsage(totalUsage, chargedCycleUsage(cycle, violations), violations);
  addUsage(workUsage, cycle.usage.work, violations);
}

function checkCheckpoint(normalized, totalUsage, committedTickets, violations) {
  const checkpoint = normalized.stop.checkpoint;
  if (!checkpoint) {
    addViolation(violations, 'safe-checkpoint-required');
    return;
  }
  const finalSnapshot = normalized.frontier_snapshots.at(-1);
  if (!finalSnapshot) {
    addViolation(violations, 'checkpoint-mismatch');
    return;
  }
  const hard = normalized.invocation.budget.hard;
  const expectedRemaining = {};
  for (const key of Object.keys(hard)) {
    expectedRemaining[key] = hard[key] - totalUsage[key];
  }
  if (checkpoint.invocation_id !== normalized.invocation.invocation_id
      || checkpoint.map_id !== normalized.invocation.map_id
      || checkpoint.map_revision !== finalSnapshot.map_revision
      || checkpoint.frontier_revision !== finalSnapshot.frontier_revision
      || checkpoint.stop_reason !== normalized.stop.reason) {
    addViolation(violations, 'checkpoint-mismatch');
  }
  for (const key of Object.keys(totalUsage)) {
    if (checkpoint.usage[key] !== totalUsage[key]
        || checkpoint.remaining_budget[key] !== expectedRemaining[key]) {
      addViolation(violations, 'checkpoint-mismatch');
    }
  }
  const completedEntries = [...committedTickets.entries()].map(([ticket_id, revision]) => ({
    ticket_id,
    revision,
  }));
  if (checkpoint.completed_count !== completedEntries.length
      || checkpoint.completed_digest !== completedDigest(completedEntries)) {
    addViolation(violations, 'checkpoint-mismatch');
  }
  if (checkpoint.recent_completed.length > 0) {
    const expectedRecent = completedEntries.slice(-AUTONOMY_DEFAULTS.maxRecentCompleted);
    const actualRecent = checkpoint.recent_completed;
    if (actualRecent.length > expectedRecent.length
        || actualRecent.some((entry, index) => {
          const expected = expectedRecent[expectedRecent.length - actualRecent.length + index];
          return !expected
            || entry.ticket_id !== expected.ticket_id
            || entry.revision !== expected.revision;
        })) {
      addViolation(violations, 'checkpoint-mismatch');
    }
  }
  const finalCycle = normalized.cycles.at(-1);
  if (finalCycle
      && ['consumed', 'release-verified'].includes(finalCycle.claim.lifecycle.at(-1))
      && checkpoint.claim !== null) {
    addViolation(violations, 'checkpoint-mismatch');
  }
}

function checkCycles(normalized, violations) {
  const { cycles, frontier_snapshots: snapshots } = normalized;
  const committedTickets = new Map();
  const seenClaims = new Set();
  const totalUsage = { time_ms: 0, token_units: 0, tool_calls: 0 };
  const workUsage = { time_ms: 0, token_units: 0, tool_calls: 0 };
  let stopped = false;
  let previousFinished = null;
  cycles.forEach((cycle, index) => {
    if (stopped) addViolation(violations, 'cycle-after-stop');
    if (cycle.cycle !== index + 1 || cycle.snapshot_sequence !== index) {
      addViolation(violations, 'cycle-order');
    }
    const before = snapshots[index];
    const after = snapshots[index + 1];
    if (!before || !after) {
      addViolation(violations, 'frontier-recomputation-missing');
      return;
    }
    if (!before.frontier.includes(cycle.selected_ticket)) {
      addViolation(violations, 'ticket-not-in-frontier');
    }
    if (cycle.claim.acquired_revision !== before.revision
        || before.frontier_revision !== cycle.claim.acquired_revision
        || after.revision <= before.revision) {
      addViolation(violations, 'stale-frontier');
    }
    const started = parseTimestamp(cycle.timing.started_at, `cycles[${index}].timing.started_at`);
    const finished = parseTimestamp(cycle.timing.finished_at, `cycles[${index}].timing.finished_at`);
    const acquired = parseTimestamp(
      cycle.claim.acquired_at,
      `cycles[${index}].claim.acquired_at`,
    );
    const expires = parseTimestamp(
      cycle.claim.expires_at,
      `cycles[${index}].claim.expires_at`,
    );
    if (previousFinished !== null && started < previousFinished) {
      addViolation(violations, 'elapsed-nonmonotonic');
    }
    if (acquired < started || acquired > finished || expires <= finished) {
      addViolation(violations, 'claim-time-outside-cycle');
    }
    previousFinished = finished;
    checkClaim(cycle, index, normalized, seenClaims, violations);
    checkWorkerOperations(cycle, normalized, violations);
    checkControllerOperations(cycle, violations);
    checkDispatchBinding(cycle, violations);
    for (const receipt of cycle.receipts) {
      if (receipt.ticket_id !== cycle.selected_ticket) {
        addViolation(violations, 'receipt-ticket-mismatch');
      }
    }
    if (cycle.outcome === 'succeeded') {
      if (!cycle.committed
          || cycle.committed.ticket_id !== cycle.selected_ticket
          || cycle.committed.revision <= cycle.claim.acquired_revision
          || cycle.committed.revision > after.revision) {
        addViolation(violations, 'commit-revision');
      } else {
        if (committedTickets.has(cycle.committed.ticket_id)) {
          addViolation(violations, 'double-commit');
        }
        committedTickets.set(cycle.committed.ticket_id, cycle.committed.revision);
      }
      if (after.frontier.includes(cycle.selected_ticket)) {
        addViolation(violations, 'frontier-not-recomputed');
      }
    } else {
      if (cycle.committed) {
        addViolation(violations, 'non-success-committed-result');
      }
      if (index !== cycles.length - 1) addViolation(violations, 'cycle-after-stop');
      stopped = true;
    }
    checkUsage(cycle, totalUsage, workUsage, violations);
  });

  const { hard, reserve } = normalized.invocation.budget;
  for (const key of Object.keys(totalUsage)) {
    if (totalUsage[key] > hard[key]) addViolation(violations, 'hard-budget-exceeded');
    const protectedUsage = safeAdd(workUsage[key], reserve[key]);
    if (protectedUsage === null || protectedUsage > hard[key]) {
      addViolation(violations, 'work-consumes-reserve');
    }
  }
  for (let index = 0; index < cycles.length - 1; index += 1) {
    const used = { time_ms: 0, token_units: 0, tool_calls: 0 };
    for (let prior = 0; prior <= index; prior += 1) {
      addUsage(used, chargedCycleUsage(normalized.cycles[prior], violations), violations);
    }
    if (Object.keys(hard).some((key) => hard[key] - used[key] < reserve[key])) {
      addViolation(violations, 'unsafe-new-claim');
    }
  }
  return { committedTickets, totalUsage };
}

function checkStopAndHandoff(normalized, totalUsage, committedTickets, violations) {
  const {
    stop,
    handoff,
    original_request: request,
    frontier_snapshots: snapshots,
  } = normalized;
  const finalCycle = normalized.cycles.at(-1);
  if (!STOP_REASONS.has(stop.reason) || !stop.substantive) {
    addViolation(violations, 'non-substantive-stop');
  }
  if (finalCycle && finalCycle.outcome !== 'succeeded' && finalCycle.outcome !== stop.reason) {
    addViolation(violations, 'stop-outcome-mismatch');
  }
  const finalSnapshot = snapshots.at(-1);
  const finalFrontier = finalSnapshot?.frontier ?? [];
  const state = finalSnapshot?.state;
  if (stop.reason === 'empty-frontier'
      && (!state || finalFrontier.length !== 0 || state.map_clear)) {
    addViolation(violations, 'empty-frontier-state');
  }
  if (stop.reason === 'map-clear'
      && (!state
        || finalFrontier.length !== 0
        || !state.fog_empty
        || state.map_clear !== true
        || state.unresolved_children.length > 0
        || state.blocked_children.length > 0
        || state.claimed_children.length > 0
        || state.pending_children.length > 0)) {
    addViolation(violations, 'map-clear-state');
  }
  if (stop.reason === 'claimed-frontier'
      && (!state || finalFrontier.length !== 0 || state.claimed_children.length === 0
        || state.claimed_children.some((ticketId) =>
          !state.unresolved_children.includes(ticketId)))) {
    addViolation(violations, 'claimed-frontier-state');
  }
  if (stop.reason === 'blocked-frontier'
      && (!state || finalFrontier.length !== 0 || state.blocked_children.length === 0
        || state.blocked_children.some((ticketId) =>
          !state.unresolved_children.includes(ticketId)))) {
    addViolation(violations, 'blocked-frontier-state');
  }
  if (stop.reason === 'hard-budget-exhaustion') {
    const exhausted = Object.keys(normalized.invocation.budget.hard)
      .some((key) => totalUsage[key] >= normalized.invocation.budget.hard[key]);
    if (!exhausted) addViolation(violations, 'budget-exhaustion-state');
    checkCheckpoint(normalized, totalUsage, committedTickets, violations);
  } else if (stop.checkpoint) {
    checkCheckpoint(normalized, totalUsage, committedTickets, violations);
  }
  const requiredFlag = STOP_FLAG_KEYS.get(stop.reason);
  if (requiredFlag && (!stop.evidence || stop.flags[requiredFlag] !== true)) {
    addViolation(violations, 'stop-evidence-required');
  }
  if (handoff) {
    if (stop.reason !== 'map-clear') addViolation(violations, 'handoff-before-map-clear');
    if (handoff.target === 'requirements-and-spec-writing') {
      if (request.type !== 'implementation' || !request.clear || !request.authorized
          || handoff.authorized_by !== 'original-request') {
        addViolation(violations, 'handoff-authorization');
      }
    } else if (handoff.target === 'planning-and-task-breakdown') {
      if (!request.authorized || !request.clear
          || !request.specification_approved || !handoff.specification_approved) {
        addViolation(violations, 'specification-approval-required');
      }
      if (request.approval_reference !== null
          && handoff.authorized_by !== request.approval_reference) {
        addViolation(violations, 'planning-approval-reference');
      }
      const approval = normalized.trusted_approval;
      if (!approval) {
        addViolation(violations, 'planning-approval-required');
        if (request.approval_reference !== null
            && !trustedHumanIdentity(request.approval_reference, normalized.invocation.owner_id)) {
          addViolation(violations, 'planning-approval-untrusted');
        }
        if (handoff.approval_id === null || handoff.approval_digest === null) {
          addViolation(violations, 'planning-approval-reference');
        }
      } else {
        const requestHash = request.request_sha256;
        if (!requestHash || approval.original_request_sha256 !== requestHash) {
          addViolation(violations, 'planning-approval-request-mismatch');
        }
        if (!trustedHumanIdentity(approval.actor_id, normalized.invocation.owner_id)
            || !trustedHumanIdentity(handoff.authorized_by, normalized.invocation.owner_id)
            || handoff.authorized_by !== approval.actor_id) {
          addViolation(violations, 'planning-approval-untrusted');
        }
        if (handoff.approval_id !== approval.approval_id) {
          addViolation(violations, 'planning-approval-reference');
        }
        if (handoff.approval_digest === null
            || !approvalDigests(approval).includes(handoff.approval_digest)) {
          addViolation(violations, 'planning-approval-digest');
        }
        if (approval.allowed_handoff !== handoff.target) {
          addViolation(violations, 'planning-approval-handoff');
        }
        if (handoff.verifier_id !== null && handoff.verifier_id !== approval.verifier_id) {
          addViolation(violations, 'planning-approval-verifier');
        }
        const finalTime = finalCycle
          ? parseTimestamp(
            finalCycle.timing.finished_at,
            'cycles.final.timing.finished_at',
          )
          : Number.NEGATIVE_INFINITY;
        if (parseTimestamp(approval.issued_at, 'trusted_approval.issued_at') > finalTime
            || parseTimestamp(approval.expires_at, 'trusted_approval.expires_at') <= finalTime) {
          addViolation(violations, 'planning-approval-expired');
        }
      }
    } else {
      addViolation(violations, 'handoff-target-forbidden');
    }
  } else if (stop.reason === 'map-clear' && request.type === 'implementation') {
    addViolation(violations, 'handoff-required');
  }
}

export function evaluateAutonomyTrace(input) {
  const normalized = normalizeInput(input);
  const violations = [];
  checkBudget(normalized, violations);
  checkSnapshots(normalized, violations);
  const { committedTickets, totalUsage } = checkCycles(normalized, violations);
  checkStopAndHandoff(normalized, totalUsage, committedTickets, violations);

  const { hard } = normalized.invocation.budget;
  const remainingBudget = {};
  for (const key of Object.keys(hard)) remainingBudget[key] = hard[key] - totalUsage[key];
  const committedEntries = [...committedTickets.entries()].map(([ticket_id, revision]) => ({
    ticket_id,
    revision,
  }));
  const recentCommitted = committedEntries.slice(-AUTONOMY_DEFAULTS.maxRecentCompleted);
  return {
    schemaVersion: SCHEMA_VERSION,
    valid: violations.length === 0,
    cycles: normalized.cycles.length,
    committed_count: committedEntries.length,
    committed_digest: completedDigest(committedEntries),
    committed_tickets: recentCommitted.map((entry) => entry.ticket_id),
    committed_revisions: recentCommitted.map((entry) => entry.revision),
    remaining_budget: remainingBudget,
    frontier_snapshots: normalized.frontier_snapshots.length,
    handoff: clone(normalized.handoff),
    stop_reason: normalized.stop.reason,
    violation_codes: violations,
  };
}

export const evaluateAutonomyContract = evaluateAutonomyTrace;
export const validateAutonomyTrace = evaluateAutonomyTrace;

async function readStdin() {
  let input = '';
  let size = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    size += byteLength(chunk);
    if (size > AUTONOMY_DEFAULTS.inputBytes) {
      fail(`input must not exceed ${AUTONOMY_DEFAULTS.inputBytes} serialized UTF-8 bytes.`);
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
    const result = evaluateAutonomyTrace(input);
    if (!result.valid) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: 'invalid-trace',
          message: 'Trace violates the Wayfinder autonomy contract.',
          violation_codes: result.violation_codes,
        },
        result,
      })}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
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
