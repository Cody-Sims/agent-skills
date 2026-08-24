import { readFileSync } from 'node:fs';

import { isCalendarDate } from './lifecycle.mjs';
import {
  assertNoSymlinkComponents,
  sha256,
} from './paths.mjs';

const INPUT_KEYS = [
  'baselineBehavior',
  'currentBehavior',
  'baselineRouting',
  'currentRouting',
  'baselineRuntime',
  'currentRuntime',
  'lifecycle',
];
const SAFE_SUBJECT = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const STATUS_RANK = { fail: 0, skip: 1, pass: 2 };

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function valueAt(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function requiredString(value, path, label) {
  const result = valueAt(value, path);
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`${label} is missing required ${path}.`);
  }
  return result;
}

function requiredMetric(value, path, label) {
  const result = valueAt(value, path);
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) {
    throw new Error(`${label} is missing valid non-negative ${path}.`);
  }
  return result;
}

function optionalMetric(value, paths) {
  for (const path of paths) {
    const result = valueAt(value, path);
    if (typeof result === 'number' && Number.isFinite(result) && result >= 0) return result;
  }
  return null;
}

function comparableIdentity(label, baseline, current, paths) {
  for (const path of paths) {
    const before = valueAt(baseline, path);
    const after = valueAt(current, path);
    if (before === undefined && after === undefined) continue;
    if (before === undefined || after === undefined
      || JSON.stringify(canonical(before)) !== JSON.stringify(canonical(after))) {
      throw new Error(`${label} ${path} identity mismatch; refusing to compare unlike runs.`);
    }
  }
}

function requireExecutionIdentity(label, artifact) {
  const adapter = artifact?.adapter;
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)
      || typeof adapter.id !== 'string' || adapter.id.length === 0
      || typeof adapter.model !== 'string' || adapter.model.length === 0) {
    throw new Error(`${label} adapter and model identity is required.`);
  }
}

function routingCaseIdentity(artifact) {
  if (!Array.isArray(artifact?.cases)) return undefined;
  return artifact.cases.map((entry) => ({
    id: entry?.id,
    split: entry?.split,
    promptSha256: entry?.promptSha256,
    expected: entry?.expected,
    excluded: entry?.excluded,
  }));
}

function runtimeMap(artifact, label) {
  if (!Array.isArray(artifact?.runtimes)) {
    throw new Error(`${label} is missing required runtimes.`);
  }
  const result = new Map();
  for (const runtime of artifact.runtimes) {
    if (!SAFE_SUBJECT.test(runtime?.runtime ?? '') || !(runtime.status in STATUS_RANK)) {
      throw new Error(`${label} contains an invalid runtime identity or status.`);
    }
    if (result.has(runtime.runtime)) throw new Error(`${label} contains duplicate runtime ${runtime.runtime}.`);
    result.set(runtime.runtime, runtime);
  }
  return result;
}

function assertComparableInputs(input) {
  requireExecutionIdentity('Baseline Behavior', input.baselineBehavior);
  requireExecutionIdentity('Current Behavior', input.currentBehavior);
  comparableIdentity('Behavior', input.baselineBehavior, input.currentBehavior, [
    'schemaVersion',
    'suite',
    'skill',
    'suiteSha256',
    'skillSha256',
    'adapter',
    'adapterId',
    'model',
    'modelId',
    'identity.adapter',
    'identity.model',
    'metadata.adapter',
    'metadata.model',
    'run.adapter',
    'run.model',
  ]);
  requiredString(input.baselineBehavior, 'suite', 'Baseline behavior artifact');
  requiredString(input.currentBehavior, 'suite', 'Current behavior artifact');
  requiredString(input.baselineBehavior, 'skill', 'Baseline behavior artifact');
  requiredString(input.currentBehavior, 'skill', 'Current behavior artifact');

  requireExecutionIdentity('Baseline Routing', input.baselineRouting);
  requireExecutionIdentity('Current Routing', input.currentRouting);
  comparableIdentity('Routing', input.baselineRouting, input.currentRouting, [
    'schemaVersion',
    'suite',
    'suiteSha256',
    'adapter',
    'adapterId',
    'model',
    'modelId',
    'identity.adapter',
    'identity.model',
    'metadata.adapter',
    'metadata.model',
    'run.adapter',
    'run.model',
  ]);
  requiredString(input.baselineRouting, 'suite', 'Baseline routing artifact');
  requiredString(input.currentRouting, 'suite', 'Current routing artifact');
  const baselineCases = routingCaseIdentity(input.baselineRouting);
  const currentCases = routingCaseIdentity(input.currentRouting);
  if ((baselineCases === undefined) !== (currentCases === undefined)
    || (baselineCases !== undefined
      && JSON.stringify(canonical(baselineCases)) !== JSON.stringify(canonical(currentCases)))) {
    throw new Error('Routing case identity mismatch; refusing to compare unlike runs.');
  }

  comparableIdentity('Runtime', input.baselineRuntime, input.currentRuntime, [
    'schemaVersion',
    'suite',
    'suiteSha256',
    'skill',
    'skillSha256',
    'model',
    'modelId',
  ]);
  requiredString(input.baselineRuntime, 'suite', 'Baseline runtime artifact');
  requiredString(input.currentRuntime, 'suite', 'Current runtime artifact');
  const before = runtimeMap(input.baselineRuntime, 'Baseline runtime artifact');
  const after = runtimeMap(input.currentRuntime, 'Current runtime artifact');
  if ([...before.keys()].sort().join('\0') !== [...after.keys()].sort().join('\0')) {
    throw new Error('Runtime set identity mismatch; refusing to compare unlike runs.');
  }
  for (const [runtime, baseline] of before) {
    const current = after.get(runtime);
    comparableIdentity(`Runtime ${runtime} adapter`, baseline, current, [
      'adapter.configured',
      'adapter.id',
      'adapter.kind',
      'adapter.sha256',
      'adapter.policySha256',
    ]);
  }
  return { baselineRuntimes: before, currentRuntimes: after };
}

function addNumericRegression(findings, {
  type,
  source,
  metric,
  subject,
  baseline,
  current,
  direction = 'increase',
}) {
  const regressed = direction === 'increase' ? current > baseline : current < baseline;
  if (!regressed) return;
  findings.push({
    type,
    source,
    metric,
    subject,
    baseline,
    current,
    delta: current - baseline,
  });
}

function compareCost(findings, source, subject, baseline, current, prefix) {
  const metrics = [
    ['token-total', [`${prefix}.tokens.total`]],
    ['duration-ms', [`${prefix}.durationMs`]],
    ['cost-usd', [`${prefix}.costUsd`, `${prefix}.cost`, `${prefix}.usage.costUsd`]],
  ];
  for (const [metric, paths] of metrics) {
    const before = optionalMetric(baseline, paths);
    const after = optionalMetric(current, paths);
    if (before === null || after === null) continue;
    addNumericRegression(findings, {
      type: 'cost',
      source,
      metric,
      subject,
      baseline: before,
      current: after,
    });
  }
}

function normalizedHashes(input, supplied) {
  return Object.fromEntries(INPUT_KEYS.map((key) => {
    const candidate = supplied?.[key];
    const digest = typeof candidate === 'string' ? candidate : candidate?.sha256;
    const value = digest ?? sha256(JSON.stringify(canonical(input[key])));
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`Invalid SHA-256 for ${key}.`);
    return [key, { sha256: value }];
  }));
}

function proposalFor(findings, fingerprint) {
  if (findings.length === 0) return null;
  const lines = findings.map((finding) =>
    `- ${finding.type}/${finding.source}/${finding.metric}/${finding.subject}: `
    + `${finding.baseline} -> ${finding.current}`);
  return {
    title: `Correct ${findings.length} detected drift regressions`,
    body: [
      `Deduplication fingerprint: ${fingerprint}`,
      '',
      'Review and correct these measured regressions. Do not apply or revert product changes automatically.',
      '',
      ...lines,
    ].join('\n'),
  };
}

export function detectDrift(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Drift detection input must be an object.');
  }
  if (!isCalendarDate(input.asOf)) {
    throw new Error('--as-of must be a valid calendar date in YYYY-MM-DD form.');
  }
  for (const key of INPUT_KEYS) {
    if (!input[key] || typeof input[key] !== 'object' || Array.isArray(input[key])) {
      throw new Error(`Missing required ${key} artifact.`);
    }
  }

  const { baselineRuntimes, currentRuntimes } = assertComparableInputs(input);
  const findings = [];
  const baselinePassRate = requiredMetric(
    input.baselineBehavior,
    'summary.candidate.passRate',
    'Baseline behavior artifact',
  );
  const currentPassRate = requiredMetric(
    input.currentBehavior,
    'summary.candidate.passRate',
    'Current behavior artifact',
  );
  if (baselinePassRate > 1 || currentPassRate > 1) {
    throw new Error('Behavior pass rates must be at most 1.');
  }
  addNumericRegression(findings, {
    type: 'quality',
    source: 'behavior',
    metric: 'pass-rate',
    subject: input.baselineBehavior.skill,
    baseline: baselinePassRate,
    current: currentPassRate,
    direction: 'decrease',
  });

  for (const [metric, path, direction] of [
    ['recall', 'summary.validation.recall', 'decrease'],
    ['precision', 'summary.validation.precision', 'decrease'],
    ['collision-rate', 'summary.validation.collisionRate', 'increase'],
  ]) {
    const before = requiredMetric(input.baselineRouting, path, 'Baseline routing artifact');
    const after = requiredMetric(input.currentRouting, path, 'Current routing artifact');
    if (before > 1 || after > 1) throw new Error(`Routing ${metric} values must be at most 1.`);
    addNumericRegression(findings, {
      type: 'routing',
      source: 'routing',
      metric,
      subject: 'validation',
      baseline: before,
      current: after,
      direction,
    });
  }

  compareCost(
    findings,
    'behavior',
    input.baselineBehavior.skill,
    input.baselineBehavior,
    input.currentBehavior,
    'summary.candidate',
  );
  compareCost(
    findings,
    'routing',
    'validation',
    input.baselineRouting,
    input.currentRouting,
    'summary.validation',
  );

  for (const [runtime, baseline] of baselineRuntimes) {
    const current = currentRuntimes.get(runtime);
    if (STATUS_RANK[current.status] < STATUS_RANK[baseline.status]) {
      findings.push({
        type: 'runtime-compatibility',
        source: 'runtime',
        metric: 'runtime-status',
        subject: runtime,
        baseline: baseline.status,
        current: current.status,
        delta: STATUS_RANK[current.status] - STATUS_RANK[baseline.status],
      });
    }
  }

  const lifecycleSkills = input.lifecycle.skills;
  if (!lifecycleSkills || typeof lifecycleSkills !== 'object' || Array.isArray(lifecycleSkills)) {
    throw new Error('Lifecycle artifact is missing required skills.');
  }
  for (const skill of Object.keys(lifecycleSkills).sort()) {
    const record = lifecycleSkills[skill];
    if (!SAFE_SUBJECT.test(skill)) throw new Error('Lifecycle artifact contains an unsafe skill identity.');
    if (!isCalendarDate(record?.lastReviewedAt)
      || (record.reviewDueAt !== undefined && !isCalendarDate(record.reviewDueAt))) {
      throw new Error(`Lifecycle dates for ${skill} must be valid calendar dates.`);
    }
    if (record.lastReviewedAt > input.asOf) {
      throw new Error(`Lifecycle ${skill} lastReviewedAt must not be after --as-of ${input.asOf}.`);
    }
    if (record.reviewDueAt !== undefined && record.reviewDueAt <= record.lastReviewedAt) {
      throw new Error(`Lifecycle ${skill} reviewDueAt must be after lastReviewedAt.`);
    }
    if (record.status !== 'active' || record.reviewDueAt === undefined) continue;
    if (record.reviewDueAt <= input.asOf) {
      findings.push({
        type: 'source-staleness',
        source: 'lifecycle',
        metric: 'review-due',
        subject: skill,
        baseline: record.lastReviewedAt,
        current: record.reviewDueAt,
        delta: null,
      });
    }
  }

  for (const finding of findings) {
    if (!SAFE_SUBJECT.test(finding.subject)) {
      throw new Error('Artifact identity cannot be represented safely in a drift report.');
    }
  }
  findings.sort((left, right) => {
    const leftKey = [
      left.type,
      left.source,
      left.metric,
      left.subject,
      JSON.stringify(left.baseline),
      JSON.stringify(left.current),
    ].join('\0');
    const rightKey = [
      right.type,
      right.source,
      right.metric,
      right.subject,
      JSON.stringify(right.baseline),
      JSON.stringify(right.current),
    ].join('\0');
    return leftKey.localeCompare(rightKey);
  });
  const fingerprint = sha256(JSON.stringify(canonical(findings)));
  return {
    schemaVersion: 1,
    asOf: input.asOf,
    inputs: normalizedHashes(input, input.inputHashes),
    findings,
    fingerprint,
    proposal: proposalFor(findings, fingerprint),
  };
}

function readArtifact(path, label) {
  const safePath = assertNoSymlinkComponents(path);
  let parsed;
  let content;
  try {
    content = readFileSync(safePath);
    parsed = JSON.parse(content.toString('utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label} JSON: ${error.message}`);
  }
  return { parsed, sha256: sha256(content) };
}

export function detectDriftFromFiles(options) {
  const input = { asOf: options?.asOf };
  const inputHashes = {};
  for (const key of INPUT_KEYS) {
    if (typeof options?.[key] !== 'string' || options[key].length === 0) {
      throw new Error(`Missing required ${key} path.`);
    }
    const artifact = readArtifact(options[key], key);
    input[key] = artifact.parsed;
    inputHashes[key] = artifact.sha256;
  }
  return detectDrift({ ...input, inputHashes });
}
