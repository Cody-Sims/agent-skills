#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import {
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

const HELP = `Usage: node validate-shadow.mjs [options]

Read-only validation for the shadow-drift reference JSON layout.

Options:
  --root PATH           Repository root. Defaults to the current directory.
  --format text|json    Output format. Defaults to text.
  --help                Show this help.

Exit codes:
  0   Graph is supported and fully aligned.
  1   Validation findings were reported.
  2   Input data or path safety error.
  3   Unsupported .shadow layout.
  64  Command-line usage error.
`;

const FINDING_KEYS = ['aligned', 'drifted', 'stale', 'unknown'];
const INTEGRITY_KEYS = [
  'orphanRecords',
  'unresolvedRelations',
  'missingAnchors',
  'missingEvidence',
  'indexDisagreements',
  'staleDerivedOutput',
];
const STATUSES = new Set(['observed', 'proposed', 'accepted', 'superseded']);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

class ValidationError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function parseArgs(argv) {
  const options = { root: process.cwd(), format: 'text', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      options.help = true;
    } else if (argument === '--root') {
      index += 1;
      if (!argv[index]) throw new ValidationError('USAGE', '--root requires a path.', 64);
      options.root = argv[index];
    } else if (argument === '--format') {
      index += 1;
      if (!argv[index]) throw new ValidationError('USAGE', '--format requires a value.', 64);
      options.format = argv[index];
    } else {
      throw new ValidationError('USAGE', `Unknown argument: ${argument}`, 64);
    }
  }
  if (!['text', 'json'].includes(options.format)) {
    throw new ValidationError('USAGE', '--format must be "text" or "json".', 64);
  }
  return options;
}

function entryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertRoot(root) {
  const resolvedRoot = resolve(root);
  const parsed = parse(resolvedRoot);
  let current = parsed.root;
  for (const part of relative(parsed.root, resolvedRoot).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (entryExists(current) && lstatSync(current).isSymbolicLink()) {
      throw new ValidationError('UNSAFE_PATH', 'Repository root passes through a symlink.', 2);
    }
  }
  if (!entryExists(resolvedRoot)) {
    throw new ValidationError('UNSUPPORTED_LAYOUT', 'Repository root does not exist.', 3);
  }
  const rootStat = lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink()) {
    throw new ValidationError('UNSAFE_PATH', 'Repository root must not be a symlink.', 2);
  }
  if (!rootStat.isDirectory()) {
    throw new ValidationError('UNSUPPORTED_LAYOUT', 'Repository root must be a directory.', 3);
  }
  return resolvedRoot;
}

function safePath(root, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new ValidationError('UNSUPPORTED_LAYOUT', 'Referenced paths must be non-empty strings.', 3);
  }
  if (isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\')) {
    throw new ValidationError('UNSAFE_PATH', `Absolute path is not allowed: ${candidate}`, 2);
  }

  const target = resolve(root, candidate);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new ValidationError('UNSAFE_PATH', `Path escapes repository root: ${candidate}`, 2);
  }

  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    if (entryExists(current) && lstatSync(current).isSymbolicLink()) {
      throw new ValidationError('UNSAFE_PATH', `Path passes through a symlink: ${candidate}`, 2);
    }
  }
  return target;
}

function readJson(root, path) {
  const absolute = safePath(root, path);
  let content;
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile()) {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `Expected a regular JSON file: ${path}`, 3);
    }
    content = readFileSync(absolute, 'utf8');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error?.code === 'ENOENT') {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `Required JSON file is missing: ${path}`, 3);
    }
    throw new ValidationError('READ_ERROR', `Could not read ${path}: ${error.message}`, 2);
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ValidationError('MALFORMED_JSON', `Malformed JSON in ${path}: ${error.message}`, 2);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, field, source) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('UNSUPPORTED_LAYOUT', `${source}.${field} must be a non-empty string.`, 3);
  }
}

function validateReference(reference, source, { requireDigest = false } = {}) {
  if (!isObject(reference)) {
    throw new ValidationError('UNSUPPORTED_LAYOUT', `${source} must be an object.`, 3);
  }
  requireString(reference.path, 'path', source);
  if (reference.sha256 !== undefined
      && (typeof reference.sha256 !== 'string' || !SHA256_PATTERN.test(reference.sha256))) {
    throw new ValidationError('UNSUPPORTED_LAYOUT', `${source}.sha256 must be a lowercase SHA-256 digest.`, 3);
  }
  if (reference.contains !== undefined || requireDigest) {
    if (reference.contains !== undefined && typeof reference.contains !== 'string') {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `${source}.contains must be a string.`, 3);
    }
    if (reference.contains !== undefined && reference.contains.trim().length === 0) {
      throw new ValidationError(
        'UNSUPPORTED_LAYOUT',
        `${source}.contains must contain non-whitespace text.`,
        3,
      );
    }
    if (requireDigest && reference.sha256 === undefined) {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `${source}.sha256 is required.`, 3);
    }
  }
}

function validateIndex(index) {
  if (!isObject(index) || index.schemaVersion !== 1
      || !Array.isArray(index.decisions)
      || (index.derived !== undefined && !Array.isArray(index.derived))) {
    throw new ValidationError(
      'UNSUPPORTED_LAYOUT',
      'Reference layout requires .shadow/index.json with schemaVersion 1 and decisions/derived arrays.',
      3,
    );
  }
  for (const [position, entry] of index.decisions.entries()) {
    const source = `.shadow/index.json.decisions[${position}]`;
    if (!isObject(entry)) {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `${source} must be an object.`, 3);
    }
    requireString(entry.id, 'id', source);
    requireString(entry.path, 'path', source);
    if (!/^\.shadow\/decisions\/[^/]+\.json$/.test(entry.path)) {
      throw new ValidationError(
        'UNSUPPORTED_LAYOUT',
        `${source}.path must name one JSON file directly under .shadow/decisions/.`,
        3,
      );
    }
  }
  for (const [position, entry] of (index.derived ?? []).entries()) {
    const source = `.shadow/index.json.derived[${position}]`;
    if (!isObject(entry) || !Array.isArray(entry.sources)) {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `${source} must contain path and sources.`, 3);
    }
    requireString(entry.path, 'path', source);
    for (const [sourcePosition, reference] of entry.sources.entries()) {
      validateReference(reference, `${source}.sources[${sourcePosition}]`, { requireDigest: true });
    }
  }
}

function validateDecision(decision, path) {
  if (!isObject(decision) || decision.schemaVersion !== 1) {
    throw new ValidationError('UNSUPPORTED_LAYOUT', `${path} must be a schemaVersion 1 decision object.`, 3);
  }
  for (const field of ['id', 'title', 'status', 'statement', 'rationale']) {
    requireString(decision[field], field, path);
  }
  if (!STATUSES.has(decision.status)) {
    throw new ValidationError(
      'UNSUPPORTED_LAYOUT',
      `${path}.status must be observed, proposed, accepted, or superseded.`,
      3,
    );
  }
  for (const field of ['anchors', 'evidence', 'relations']) {
    if (!Array.isArray(decision[field])) {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `${path}.${field} must be an array.`, 3);
    }
  }
  for (const [position, reference] of decision.anchors.entries()) {
    validateReference(reference, `${path}.anchors[${position}]`);
  }
  for (const [position, reference] of decision.evidence.entries()) {
    validateReference(reference, `${path}.evidence[${position}]`);
  }
  for (const [position, relation] of decision.relations.entries()) {
    const source = `${path}.relations[${position}]`;
    if (!isObject(relation)) {
      throw new ValidationError('UNSUPPORTED_LAYOUT', `${source} must be an object.`, 3);
    }
    requireString(relation.type, 'type', source);
    requireString(relation.target, 'target', source);
  }
}

function listDecisionFiles(root) {
  const relativeDirectory = '.shadow/decisions';
  const directory = safePath(root, relativeDirectory);
  if (!entryExists(directory) || !lstatSync(directory).isDirectory()) {
    throw new ValidationError(
      'UNSUPPORTED_LAYOUT',
      'Reference layout requires a .shadow/decisions directory.',
      3,
    );
  }
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .map((entry) => {
      if (entry.isSymbolicLink()) {
        throw new ValidationError(
          'UNSAFE_PATH',
          `Decision records must not be symlinks: ${relativeDirectory}/${entry.name}`,
          2,
        );
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        throw new ValidationError(
          'UNSUPPORTED_LAYOUT',
          'Decision records must be JSON files directly under .shadow/decisions/.',
          3,
        );
      }
      return `${relativeDirectory}/${entry.name}`;
    });
}

function hashBuffer(content) {
  return createHash('sha256').update(content).digest('hex');
}

function inspectReference(root, reference) {
  const absolute = safePath(root, reference.path);
  if (!entryExists(absolute)) return { missing: true, verified: false, drifted: false };
  const stat = lstatSync(absolute);
  if (!stat.isFile()) {
    throw new ValidationError('UNSAFE_PATH', `Referenced path is not a regular file: ${reference.path}`, 2);
  }
  const content = readFileSync(absolute);
  let verified = false;
  let drifted = false;
  const reasons = [];
  if (reference.sha256 !== undefined) {
    verified = true;
    if (hashBuffer(content) !== reference.sha256) {
      drifted = true;
      reasons.push(`SHA-256 changed for ${reference.path}`);
    }
  }
  if (reference.contains !== undefined) {
    verified = true;
    if (!content.toString('utf8').includes(reference.contains)) {
      drifted = true;
      reasons.push(`Required text is absent from ${reference.path}`);
    }
  }
  return { missing: false, verified, drifted, reasons };
}

function emptyReport() {
  return {
    schemaVersion: 1,
    supported: true,
    layout: 'shadow-drift-reference-json-v1',
    findings: Object.fromEntries(FINDING_KEYS.map((key) => [key, []])),
    integrity: Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, []])),
    errors: [],
    summary: {
      aligned: 0,
      drifted: 0,
      stale: 0,
      unknown: 0,
      integrityFindings: 0,
      exitCode: 0,
    },
  };
}

function errorReport(error) {
  const report = emptyReport();
  report.supported = error.exitCode !== 3;
  report.errors.push({ code: error.code, message: error.message });
  report.summary.exitCode = error.exitCode;
  return report;
}

function stableSort(report) {
  for (const key of FINDING_KEYS) {
    report.findings[key].sort((left, right) =>
      left.decisionId.localeCompare(right.decisionId, 'en')
      || left.reason.localeCompare(right.reason, 'en'));
  }
  for (const key of INTEGRITY_KEYS) {
    report.integrity[key].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
  }
  report.errors.sort((left, right) =>
    left.code.localeCompare(right.code, 'en') || left.message.localeCompare(right.message, 'en'));
  return report;
}

function classifyDecision(root, decision, report) {
  const anchorResults = decision.anchors.map((reference) => ({
    reference,
    result: inspectReference(root, reference),
  }));
  const evidenceResults = decision.evidence.map((reference) => ({
    reference,
    result: inspectReference(root, reference),
  }));

  if (decision.anchors.length === 0) {
    report.integrity.missingAnchors.push({ decisionId: decision.id, path: null });
  }
  if (decision.evidence.length === 0) {
    report.integrity.missingEvidence.push({ decisionId: decision.id, path: null });
  }
  for (const { reference, result } of anchorResults) {
    if (result.missing) {
      report.integrity.missingAnchors.push({ decisionId: decision.id, path: reference.path });
    }
  }
  for (const { reference, result } of evidenceResults) {
    if (result.missing) {
      report.integrity.missingEvidence.push({ decisionId: decision.id, path: reference.path });
    }
  }

  const allResults = [...anchorResults, ...evidenceResults];
  const driftReasons = allResults.flatMap(({ result }) => result.reasons ?? []);
  const allAnchorsMissing = anchorResults.length > 0
    && anchorResults.every(({ result }) => result.missing);
  const anyMissing = allResults.some(({ result }) => result.missing);
  const verified = allResults.filter(({ result }) => result.verified).length;

  if (driftReasons.length > 0) {
    report.findings.drifted.push({
      decisionId: decision.id,
      reason: driftReasons.sort((left, right) => left.localeCompare(right, 'en')).join('; '),
    });
  } else if (allAnchorsMissing) {
    report.findings.stale.push({
      decisionId: decision.id,
      reason: 'No declared implementation anchor remains.',
    });
  } else if (!anyMissing && verified > 0) {
    report.findings.aligned.push({
      decisionId: decision.id,
      reason: 'All declared checks match current repository files.',
    });
  } else {
    report.findings.unknown.push({
      decisionId: decision.id,
      reason: anyMissing
        ? 'Available evidence is incomplete.'
        : 'No digest or content check supports a comparison.',
    });
  }
}

function validateGraph(rootOption) {
  const root = assertRoot(rootOption);
  const indexPath = '.shadow/index.json';
  const indexAbsolute = safePath(root, indexPath);
  if (!entryExists(indexAbsolute)) {
    throw new ValidationError(
      'UNSUPPORTED_LAYOUT',
      'No .shadow/index.json was found. Use the repository-declared validator for other layouts.',
      3,
    );
  }
  const index = readJson(root, indexPath);
  validateIndex(index);

  const report = emptyReport();
  const recordPaths = listDecisionFiles(root);
  const recordsByPath = new Map();
  const recordsById = new Map();
  for (const path of recordPaths) {
    const decision = readJson(root, path);
    validateDecision(decision, path);
    recordsByPath.set(path, decision);
    if (!recordsById.has(decision.id)) recordsById.set(decision.id, []);
    recordsById.get(decision.id).push({ decision, path });
  }

  const indexedPaths = new Set();
  const indexedIds = new Set();
  for (const entry of index.decisions) {
    safePath(root, entry.path);
    indexedPaths.add(entry.path);
    if (indexedIds.has(entry.id)) {
      report.integrity.indexDisagreements.push({
        indexedId: entry.id,
        path: entry.path,
        recordId: null,
        reason: 'Duplicate decision id in index.',
      });
    }
    indexedIds.add(entry.id);
    const record = recordsByPath.get(entry.path);
    if (!record) {
      report.integrity.indexDisagreements.push({
        indexedId: entry.id,
        path: entry.path,
        recordId: null,
      });
    } else if (record.id !== entry.id) {
      report.integrity.indexDisagreements.push({
        indexedId: entry.id,
        path: entry.path,
        recordId: record.id,
      });
    }
  }

  for (const [path, decision] of recordsByPath) {
    if (!indexedPaths.has(path)) {
      report.integrity.orphanRecords.push({ decisionId: decision.id, path });
    }
  }
  for (const [id, records] of recordsById) {
    if (records.length > 1) {
      for (const record of records) {
        report.integrity.indexDisagreements.push({
          indexedId: indexedIds.has(id) ? id : null,
          path: record.path,
          recordId: id,
          reason: 'Duplicate decision id across records.',
        });
      }
    }
  }

  for (const decision of recordsByPath.values()) {
    for (const relation of decision.relations) {
      if (!recordsById.has(relation.target)) {
        report.integrity.unresolvedRelations.push({
          decisionId: decision.id,
          relationType: relation.type,
          target: relation.target,
        });
      }
    }
    classifyDecision(root, decision, report);
  }

  for (const derived of index.derived ?? []) {
    const output = safePath(root, derived.path);
    let reason = null;
    if (!entryExists(output)) {
      reason = 'Derived output is missing.';
    } else if (!lstatSync(output).isFile()) {
      throw new ValidationError('UNSAFE_PATH', `Derived output is not a regular file: ${derived.path}`, 2);
    }
    for (const source of derived.sources) {
      const result = inspectReference(root, source);
      if (result.missing) {
        reason = `Derived source is missing: ${source.path}`;
        break;
      }
      if (result.drifted) {
        reason = `Derived source changed: ${source.path}`;
        break;
      }
    }
    if (reason !== null) {
      report.integrity.staleDerivedOutput.push({ path: derived.path, reason });
    }
  }

  stableSort(report);
  for (const key of FINDING_KEYS) report.summary[key] = report.findings[key].length;
  report.summary.integrityFindings = INTEGRITY_KEYS
    .reduce((total, key) => total + report.integrity[key].length, 0);
  if (report.summary.drifted > 0
      || report.summary.stale > 0
      || report.summary.unknown > 0
      || report.summary.integrityFindings > 0) {
    report.summary.exitCode = 1;
  }
  return report;
}

function formatText(report) {
  const lines = [
    'shadow-drift reference JSON validation',
    `supported: ${report.supported ? 'yes' : 'no'}`,
    `exit code: ${report.summary.exitCode}`,
  ];
  if (report.errors.length > 0) {
    lines.push('errors:');
    for (const error of report.errors) lines.push(`- ${error.code}: ${error.message}`);
    return `${lines.join('\n')}\n`;
  }
  for (const key of FINDING_KEYS) {
    lines.push(`${key}: ${report.findings[key].length}`);
    for (const finding of report.findings[key]) {
      lines.push(`- ${finding.decisionId}: ${finding.reason}`);
    }
  }
  for (const key of INTEGRITY_KEYS) {
    lines.push(`${key}: ${report.integrity[key].length}`);
    for (const finding of report.integrity[key]) lines.push(`- ${JSON.stringify(finding)}`);
  }
  return `${lines.join('\n')}\n`;
}

function emit(report, format) {
  process.stdout.write(format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatText(report));
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 64;
    return;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  try {
    const report = validateGraph(options.root);
    emit(report, options.format);
    process.exitCode = report.summary.exitCode;
  } catch (error) {
    const normalized = error instanceof ValidationError
      ? error
      : new ValidationError('INTERNAL_ERROR', error.message, 2);
    const report = errorReport(normalized);
    emit(report, options.format);
    process.exitCode = normalized.exitCode;
  }
}

main();
