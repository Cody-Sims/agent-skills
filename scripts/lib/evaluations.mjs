import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { assertNoSymlinks, pathEntryExists, sha256, walkFiles } from './paths.mjs';
import { validateAgainstSchema } from './jsonschema.mjs';
import { gradeRegex } from './regex-grader.mjs';
import { runJsonAdapterAsync } from './process-adapter.mjs';

const MAX_OUTPUT_LENGTH = 256 * 1024;
const CANDIDATE_SKILL_DIRECTORY = '.candidate-skill';
const TEXT_ASSERTIONS = new Set(['contains', 'notContains', 'regex']);
const VALUE_ASSERTIONS = new Set([...TEXT_ASSERTIONS, 'fileContains', 'fileEquals']);
const OUTCOME_ASSERTIONS = new Set(['fileContains', 'fileEquals', 'fileAbsent', 'unchanged', 'command']);

function assertRelativePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0')
      || isAbsolute(path) || /^[A-Za-z]:|^\\/.test(path)
      || path.split(/[\\/]/).includes('..')) {
    throw new Error('Assertion path must be relative and must not escape its managed root.');
  }
}

function duplicateIds(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return true;
    seen.add(item.id);
    return false;
  }).map((item) => item.id);
}

export function validateEvaluationSuite(schema, suite) {
  const errors = validateAgainstSchema(schema, suite);
  if (suite?.cases?.length === 0) errors.push('$.cases: at least one case is required.');
  if (!suite || typeof suite !== 'object' || Array.isArray(suite)
      || !Array.isArray(suite.cases)
      || suite.cases.some((entry) => !entry || typeof entry !== 'object' || !Array.isArray(entry.assertions))) {
    return errors;
  }
  for (const duplicate of duplicateIds(suite.cases ?? [])) errors.push(`$.cases: duplicate case ID ${JSON.stringify(duplicate)}.`);
  for (const [caseIndex, evaluationCase] of (suite.cases ?? []).entries()) {
    if (evaluationCase.setup) {
      if (suite.schemaVersion !== 2) errors.push(`$.cases[${caseIndex}].setup: setup requires schemaVersion 2.`);
      try {
        assertRelativePath(evaluationCase.setup.path);
      } catch (error) {
        errors.push(`$.cases[${caseIndex}].setup.path: ${error.message}`);
      }
    }
    if (evaluationCase.assertions?.length === 0) errors.push(`$.cases[${caseIndex}].assertions: at least one objective assertion is required.`);
    if (evaluationCase.assertions?.length > 100) errors.push(`$.cases[${caseIndex}].assertions: maximum of 100 assertions is allowed.`);
    for (const duplicate of duplicateIds(evaluationCase.assertions ?? [])) {
      errors.push(`$.cases[${caseIndex}].assertions: duplicate assertion ID ${JSON.stringify(duplicate)}.`);
    }
    for (const [assertionIndex, assertion] of (evaluationCase.assertions ?? []).entries()) {
      if (!assertion || typeof assertion !== 'object') continue;
      const location = `$.cases[${caseIndex}].assertions[${assertionIndex}]`;
      if (VALUE_ASSERTIONS.has(assertion.type) && typeof assertion.value !== 'string') {
        errors.push(`${location}: assertion requires a string value.`);
      }
      if (OUTCOME_ASSERTIONS.has(assertion.type)) {
        if (suite.schemaVersion !== 2) errors.push(`${location}: outcome assertions require schemaVersion 2.`);
        try {
          assertRelativePath(assertion.path);
        } catch (error) {
          errors.push(`${location}.path: ${error.message}`);
        }
      }
      if (assertion.value?.length > 1000) errors.push(`$.cases[${caseIndex}].assertions[${assertionIndex}].value: maximum length is 1000 characters.`);
      if (assertion.type !== 'regex') continue;
      try {
        new RegExp(assertion.value, assertion.flags ?? '');
      } catch (error) {
        errors.push(`$.cases[${caseIndex}].assertions[${assertionIndex}]: invalid regular expression (${error.message}).`);
      }
    }
  }
  return errors;
}

export function validateEvaluationResult(schema, result) {
  const errors = validateAgainstSchema(schema, result);
  if (errors.length > 0) return errors;
  if (result.schemaVersion >= 2 && !result.adapter) {
    errors.push('$.adapter: versioned results require adapter and exact model identity.');
  }
  if (result.cases?.length === 0) errors.push('$.cases: at least one case result is required.');
  for (const [caseIndex, entry] of (result.cases ?? []).entries()) {
    for (const variant of ['baseline', 'candidate']) {
      const value = entry[variant];
      if (!value) continue;
      if (result.schemaVersion !== 3 && value.assertions.some((assertion) => OUTCOME_ASSERTIONS.has(assertion.type))) {
        errors.push(`$.cases[${caseIndex}].${variant}: outcome assertions require result schemaVersion 3.`);
      }
      const passed = value.assertions.filter((assertion) => assertion.passed).length;
      const total = value.assertions.length;
      const passRate = total === 0 ? 0 : passed / total;
      if (value.passed !== passed || value.total !== total || value.passRate !== passRate) {
        errors.push(`$.cases[${caseIndex}].${variant}: metrics do not match assertion results.`);
      }
      if (value.tokens.total !== value.tokens.input + value.tokens.output) {
        errors.push(`$.cases[${caseIndex}].${variant}.tokens.total: total does not match input plus output.`);
      }
    }
  }
  const expectedBaseline = summarize(result.cases ?? [], 'baseline');
  const expectedCandidate = summarize(result.cases ?? [], 'candidate');
  if (!isDeepStrictEqual(result.summary?.baseline, expectedBaseline)) {
    errors.push('$.summary.baseline: baseline summary does not match case results.');
  }
  if (!isDeepStrictEqual(result.summary?.candidate, expectedCandidate)) {
    errors.push('$.summary.candidate: candidate summary does not match case results.');
  }
  const expectedDelta = expectedCandidate.passRate - expectedBaseline.passRate;
  if (result.summary?.passRateDelta !== expectedDelta) {
    errors.push('$.summary.passRateDelta: delta does not match candidate minus baseline.');
  }
  return errors;
}

function snapshot(root, path) {
  const target = assertNoSymlinks(root, path);
  if (!pathEntryExists(target)) return null;
  const entries = [];
  let bytes = 0;
  function visit(absolute, relativePath) {
    if (entries.length >= 2_000) throw new Error('Evaluation snapshot exceeds 2000 entries.');
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      entries.push([relativePath, 'symlink', readlinkSync(absolute)]);
    } else if (stat.isDirectory()) {
      entries.push([relativePath, 'directory', stat.mode]);
      for (const name of readdirSync(absolute).sort()) visit(resolve(absolute, name), `${relativePath}/${name}`);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 16 * 1024 * 1024) throw new Error('Evaluation snapshot exceeds 16 MiB.');
      entries.push([relativePath, 'file', stat.mode, sha256(readFileSync(absolute))]);
    } else {
      throw new Error('Evaluation snapshot contains a non-file resource.');
    }
  }
  visit(target, '.');
  return sha256(JSON.stringify(entries));
}

async function runTrustedCommand(spec, { workspace, suiteDirectory }, label) {
  if (!suiteDirectory) throw new Error('suiteDirectory is required for trusted evaluation commands.');
  assertRelativePath(spec.path);
  const command = assertNoSymlinks(suiteDirectory, spec.path);
  if (!lstatSync(command).isFile()) throw new Error('Evaluation command must be a regular file.');
  const timeoutMs = spec.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new Error('Evaluation command timeoutMs must be between 1 and 30000.');
  }
  const { response } = await runJsonAdapterAsync({
    command: process.execPath,
    args: [command],
    cwd: workspace,
    request: { protocolVersion: 1, workspace },
    timeoutMs,
    label,
  });
  return response;
}

async function gradeAssertion(assertion, text, { workspace, suiteDirectory, snapshots }) {
  if (OUTCOME_ASSERTIONS.has(assertion.type)) {
    assertRelativePath(assertion.path);
    if (assertion.type === 'command') {
      const response = await runTrustedCommand(assertion, { workspace, suiteDirectory }, `Independent oracle ${assertion.id}`);
      if (typeof response?.passed !== 'boolean') throw new Error('Independent oracle must return a boolean passed field.');
      return {
        id: assertion.id,
        type: assertion.type,
        passed: response.passed,
        evidence: response.passed ? 'Independent command passed.' : 'Independent command failed.',
      };
    }
    let passed = false;
    try {
      const target = assertNoSymlinks(workspace, assertion.path);
      if (assertion.type === 'unchanged') {
        passed = snapshot(workspace, assertion.path) === snapshots.get(assertion.id);
      } else if (assertion.type === 'fileAbsent') {
        passed = !pathEntryExists(target);
      } else if (pathEntryExists(target)) {
        const stat = lstatSync(target);
        if (stat.isFile() && stat.size <= MAX_OUTPUT_LENGTH) {
          const content = readFileSync(target, 'utf8');
          passed = assertion.type === 'fileEquals'
            ? content === assertion.value
            : content.includes(assertion.value);
        }
      }
    } catch {
      passed = false;
    }
    return {
      id: assertion.id,
      type: assertion.type,
      passed,
      evidence: passed ? 'Workspace assertion passed.' : 'Workspace assertion failed.',
    };
  }
  if (assertion.type === 'contains') {
    const passed = text.includes(assertion.value);
    return {
      id: assertion.id,
      type: assertion.type,
      passed,
      evidence: passed ? 'Required text was present.' : 'Required text was absent.',
    };
  }
  if (assertion.type === 'notContains') {
    const passed = !text.includes(assertion.value);
    return {
      id: assertion.id,
      type: assertion.type,
      passed,
      evidence: passed ? 'Forbidden text was absent.' : 'Forbidden text was present.',
    };
  }
  if (assertion.type === 'regex') {
    const matched = await gradeRegex({
      pattern: assertion.value,
      flags: assertion.flags ?? '',
      text,
    });
    return {
      id: assertion.id,
      type: assertion.type,
      passed: matched,
      evidence: matched ? 'Regular expression matched.' : 'Regular expression did not match.',
    };
  }
  throw new Error(`Unsupported assertion type: ${assertion.type}.`);
}

async function gradeOutput(assertions, execution, context) {
  const results = [];
  for (const assertion of assertions) results.push(await gradeAssertion(assertion, execution.text, context));
  const passed = results.filter((result) => result.passed).length;
  return {
    assertions: results,
    passed,
    total: results.length,
    passRate: results.length === 0 ? 0 : passed / results.length,
    durationMs: execution.durationMs,
    tokens: {
      input: execution.inputTokens,
      output: execution.outputTokens,
      total: execution.inputTokens + execution.outputTokens,
    },
    outputSha256: sha256(execution.text),
  };
}

function summarize(cases, variant) {
  const graded = cases.map((entry) => entry[variant]);
  const passed = graded.reduce((total, result) => total + result.passed, 0);
  const assertions = graded.reduce((total, result) => total + result.total, 0);
  return {
    passed,
    assertions,
    passRate: assertions === 0 ? 0 : passed / assertions,
    durationMs: graded.reduce((total, result) => total + result.durationMs, 0),
    tokens: graded.reduce((total, result) => ({
      input: total.input + result.tokens.input,
      output: total.output + result.tokens.output,
      total: total.total + result.tokens.total,
    }), { input: 0, output: 0, total: 0 }),
  };
}

function validateExecution(execution) {
  if (!execution || typeof execution.text !== 'string') throw new Error('Evaluation adapter must return text.');
  if (execution.text.length > MAX_OUTPUT_LENGTH) {
    throw new Error(`Evaluation adapter text exceeds ${MAX_OUTPUT_LENGTH} characters.`);
  }
  for (const field of ['inputTokens', 'outputTokens']) {
    if (!Number.isSafeInteger(execution[field]) || execution[field] < 0) {
      throw new Error(`Evaluation adapter ${field} must be a non-negative safe integer.`);
    }
  }
  if (!Number.isFinite(execution.durationMs) || execution.durationMs < 0) {
    throw new Error('Evaluation adapter durationMs must be a non-negative finite number.');
  }
  if (!Number.isSafeInteger(execution.inputTokens + execution.outputTokens)) {
    throw new Error('Evaluation adapter token total must be a non-negative safe integer.');
  }
}

function copyFixture({ suiteDirectory, fixture, workspace }) {
  if (!fixture) return;
  if (!suiteDirectory) throw new Error('suiteDirectory is required when an evaluation case uses a fixture.');
  const sourceRoot = assertNoSymlinks(suiteDirectory, fixture);
  for (const relativePath of walkFiles(sourceRoot, { includeGit: true })) {
    const source = assertNoSymlinks(sourceRoot, relativePath);
    const destination = assertNoSymlinks(workspace, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function stageCandidateSkill({ skillRoot, skillContent, workspace }) {
  const destinationRoot = assertNoSymlinks(workspace, CANDIDATE_SKILL_DIRECTORY);
  mkdirSync(destinationRoot);
  if (!skillRoot) {
    writeFileSync(assertNoSymlinks(destinationRoot, 'SKILL.md'), skillContent);
    return destinationRoot;
  }

  const sourceRoot = assertNoSymlinks(skillRoot, '.');
  for (const relativePath of walkFiles(sourceRoot)) {
    const source = assertNoSymlinks(sourceRoot, relativePath);
    const destination = assertNoSymlinks(destinationRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  return destinationRoot;
}

export async function runEvaluationSuite({
  suite,
  suiteDirectory,
  skillRoot,
  skillContent,
  skillSha256 = sha256(skillContent),
  adapter,
  execute,
  tempRoot = resolve('tmp', 'evaluations'),
  generatedAt = new Date().toISOString(),
}) {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id.trim()
      || typeof adapter.model !== 'string' || !adapter.model.trim()) {
    throw new Error('Evaluation runs require an explicit adapter and model identity.');
  }
  mkdirSync(tempRoot, { recursive: true });
  const cases = [];
  for (const evaluationCase of suite.cases) {
    const variants = {};
    for (const variant of ['baseline', 'candidate']) {
      const workspace = mkdtempSync(resolve(tempRoot, `${evaluationCase.id}-${variant}-`));
      let cleanupSafe = true;
      try {
        copyFixture({ suiteDirectory, fixture: evaluationCase.fixture, workspace });
        if (evaluationCase.setup) {
          const response = await runTrustedCommand(evaluationCase.setup, { workspace, suiteDirectory }, `Fixture setup ${evaluationCase.id}`);
          if (response?.ready !== true) throw new Error('Fixture setup must confirm ready: true.');
        }
        const skillPath = variant === 'candidate'
          ? stageCandidateSkill({ skillRoot, skillContent, workspace })
          : null;
        const snapshots = new Map();
        for (const assertion of evaluationCase.assertions) {
          if (OUTCOME_ASSERTIONS.has(assertion.type)) assertRelativePath(assertion.path);
          if (assertion.type === 'unchanged') snapshots.set(assertion.id, snapshot(workspace, assertion.path));
        }
        const execution = await execute({
          case: evaluationCase,
          variant,
          workspace,
          skillPath,
          skillContent: variant === 'candidate' ? skillContent : null,
        });
        validateExecution(execution);
        variants[variant] = await gradeOutput(evaluationCase.assertions, execution, { workspace, suiteDirectory, snapshots });
      } catch (error) {
        if (error.cleanupUncertain) cleanupSafe = false;
        throw error;
      } finally {
        if (cleanupSafe) rmSync(workspace, { recursive: true, force: true });
      }
    }
    cases.push({
      id: evaluationCase.id,
      promptSha256: sha256(evaluationCase.prompt),
      baseline: variants.baseline,
      candidate: variants.candidate,
      humanReview: (evaluationCase.humanReview ?? []).map((review) => ({
        id: review.id,
        question: review.question,
        status: 'pending',
      })),
    });
  }
  const baseline = summarize(cases, 'baseline');
  const candidate = summarize(cases, 'candidate');
  return {
    schemaVersion: suite.schemaVersion === 2 ? 3 : 2,
    suite: suite.name,
    skill: suite.skill,
    suiteSha256: sha256(JSON.stringify(suite)),
    skillSha256,
    generatedAt,
    adapter: { ...adapter },
    cases,
    summary: {
      baseline,
      candidate,
      passRateDelta: candidate.passRate - baseline.passRate,
    },
  };
}