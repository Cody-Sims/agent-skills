import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { sha256 } from './paths.mjs';
import { validateAgainstSchema } from './jsonschema.mjs';
import { isCalendarDate } from './lifecycle.mjs';

export function validateRoutingSuite(schema, suite) {
  const errors = validateAgainstSchema(schema, suite);
  const cases = suite.cases ?? [];
  if (!cases.some((entry) => entry.split === 'training')) errors.push('$.cases: at least one training case is required.');
  if (!cases.some((entry) => entry.split === 'validation')) errors.push('$.cases: at least one validation case is required.');
  const ids = new Set();
  for (const [index, entry] of cases.entries()) {
    if (ids.has(entry.id)) errors.push(`$.cases[${index}]: duplicate case ID ${JSON.stringify(entry.id)}.`);
    ids.add(entry.id);
    if (entry.expected?.length === 0) errors.push(`$.cases[${index}].expected: at least one skill is required.`);
    const expectedDuplicates = entry.expected?.filter((skill, skillIndex) => entry.expected.indexOf(skill) !== skillIndex) ?? [];
    const excludedDuplicates = entry.excluded?.filter((skill, skillIndex) => entry.excluded.indexOf(skill) !== skillIndex) ?? [];
    for (const skill of new Set(expectedDuplicates)) errors.push(`$.cases[${index}].expected: duplicate expected skill ${JSON.stringify(skill)}.`);
    for (const skill of new Set(excludedDuplicates)) errors.push(`$.cases[${index}].excluded: duplicate excluded skill ${JSON.stringify(skill)}.`);
    const excluded = new Set(entry.excluded ?? []);
    for (const skill of entry.expected ?? []) {
      if (excluded.has(skill)) errors.push(`$.cases[${index}]: skill ${JSON.stringify(skill)} cannot be expected and excluded.`);
    }
  }
  return errors;
}

function thresholdContextErrors(policy, {
  suite,
  suiteSha256,
  adapter,
  generatedAt,
} = {}) {
  const errors = [];
  if (suiteSha256 && policy?.suiteSha256 !== suiteSha256) {
    errors.push('$.suiteSha256: does not match the evaluated routing suite.');
  }
  if (suite?.trials !== undefined && policy?.trials !== suite.trials) {
    errors.push('$.trials: does not match the evaluated routing suite.');
  }
  if (adapter && !isDeepStrictEqual(policy?.adapter, adapter)) {
    errors.push('$.adapter: identity does not match the configured adapter and model.');
  }
  if (!isCalendarDate(policy?.measuredAt)) {
    errors.push('$.measuredAt: value must be a valid calendar date.');
  } else if (generatedAt) {
    const generatedDate = /^\d{4}-\d{2}-\d{2}T/.test(generatedAt)
      ? generatedAt.slice(0, 10)
      : null;
    if (!generatedDate || !isCalendarDate(generatedDate)) {
      errors.push('$: generatedAt must begin with a valid calendar date.');
    } else if (policy.measuredAt > generatedDate) {
      errors.push('$.measuredAt: measured date must not be after the evaluation date.');
    }
  }
  const measured = policy?.measured;
  const limits = policy?.thresholds;
  if (limits?.minimumValidationRecall !== measured?.validationRecall) {
    errors.push('$.thresholds.minimumValidationRecall: must equal the measured baseline.');
  }
  if (limits?.minimumOverallPrecision !== measured?.overallPrecision) {
    errors.push('$.thresholds.minimumOverallPrecision: must equal the measured baseline.');
  }
  if (limits?.maximumOverallCollisionRate !== measured?.overallCollisionRate) {
    errors.push('$.thresholds.maximumOverallCollisionRate: must equal the measured baseline.');
  }
  return errors;
}

export function validateRoutingThresholdPolicy(schema, policy, context = {}) {
  const errors = validateAgainstSchema(schema, policy);
  errors.push(...thresholdContextErrors(policy, context));
  return errors;
}

export function validateRoutingResult(schema, result, context = {}) {
  const errors = validateAgainstSchema(schema, result);
  if (result.cases?.length === 0) errors.push('$.cases: at least one case result is required.');
  const summaries = {
    overall: emptyMetrics(),
    training: emptyMetrics(),
    validation: emptyMetrics(),
  };
  const confusion = {};
  for (const [caseIndex, entry] of (result.cases ?? []).entries()) {
    const expected = new Set(entry.expected);
    let activations = 0;
    for (const [trialIndex, trial] of entry.trials.entries()) {
      const selected = new Set(trial.selectedSkills);
      const truePositives = [...selected].filter((skill) => expected.has(skill)).length;
      const falsePositives = [...selected].filter((skill) => !expected.has(skill)).length;
      const falseNegatives = [...expected].filter((skill) => !selected.has(skill)).length;
      const collision = falsePositives > 0;
      if (trial.truePositives !== truePositives
          || trial.falsePositives !== falsePositives
          || trial.falseNegatives !== falseNegatives
          || trial.collision !== collision) {
        errors.push(`$.cases[${caseIndex}].trials[${trialIndex}]: metrics do not match selected skills.`);
      }
      if (trial.tokens.total !== trial.tokens.input + trial.tokens.output) {
        errors.push(`$.cases[${caseIndex}].trials[${trialIndex}].tokens.total: total does not match input plus output.`);
      }
      if ([...expected].every((skill) => selected.has(skill))) activations += 1;
      addTrial(summaries.overall, trial);
      addTrial(summaries[entry.split], trial);
      for (const expectedSkill of expected) {
        confusion[expectedSkill] ??= {};
        for (const selectedSkill of selected) {
          if (expected.has(selectedSkill)) continue;
          confusion[expectedSkill][selectedSkill] = (confusion[expectedSkill][selectedSkill] ?? 0) + 1;
        }
      }
    }
    const activationRate = entry.trials.length === 0 ? 0 : activations / entry.trials.length;
    if (entry.activationRate !== activationRate) {
      errors.push(`$.cases[${caseIndex}].activationRate: rate does not match trials.`);
    }
  }
  for (const split of ['overall', 'training', 'validation']) {
    if (!isDeepStrictEqual(result.summary?.[split], finalize(summaries[split]))) {
      errors.push(`$.summary.${split}: ${split} summary does not match case trials.`);
    }
  }
  if (!isDeepStrictEqual(result.confusion, confusion)) {
    errors.push('$.confusion: confusion matrix does not match case trials.');
  }
  if (result.thresholds !== null && result.thresholds !== undefined) {
    const thresholdEvaluation = result.thresholds;
    if (!isDeepStrictEqual(result.adapter, thresholdEvaluation.adapter)) {
      errors.push('$.adapter: adapter identity does not match the threshold evaluation.');
    }
    const observed = {
      validationRecall: result.summary?.validation?.recall,
      overallPrecision: result.summary?.overall?.precision,
      overallCollisionRate: result.summary?.overall?.collisionRate,
    };
    if (!isDeepStrictEqual(thresholdEvaluation.observed, observed)) {
      errors.push('$.thresholds.observed: observed metrics do not match summary.');
    }
    const limits = thresholdEvaluation.limits;
    const measured = thresholdEvaluation.measured;
    if (limits?.minimumValidationRecall !== measured?.validationRecall
        || limits?.minimumOverallPrecision !== measured?.overallPrecision
        || limits?.maximumOverallCollisionRate !== measured?.overallCollisionRate) {
      errors.push('$.thresholds.limits: limits do not match the measured baseline.');
    }
    const passed = observed.validationRecall >= limits?.minimumValidationRecall
      && observed.overallPrecision >= limits?.minimumOverallPrecision
      && observed.overallCollisionRate <= limits?.maximumOverallCollisionRate;
    if (thresholdEvaluation.passed !== passed) {
      errors.push('$.thresholds.passed: value does not match observed metrics and limits.');
    }
    if (!isCalendarDate(thresholdEvaluation.measuredAt)) {
      errors.push('$.thresholds.measuredAt: value must be a valid calendar date.');
    }
    if (context.thresholdPolicy) {
      const expected = {
        policySha256: context.thresholdPolicySha256
          ?? sha256(JSON.stringify(context.thresholdPolicy)),
        suiteSha256: context.thresholdPolicy.suiteSha256,
        sourceResultSha256: context.thresholdPolicy.sourceResultSha256,
        measuredAt: context.thresholdPolicy.measuredAt,
        trials: context.thresholdPolicy.trials,
        adapter: context.thresholdPolicy.adapter,
        measured: context.thresholdPolicy.measured,
        limits: context.thresholdPolicy.thresholds,
      };
      for (const [field, value] of Object.entries(expected)) {
        if (!isDeepStrictEqual(thresholdEvaluation[field], value)) {
          errors.push(`$.thresholds.${field}: value does not match the supplied threshold policy.`);
        }
      }
    }
    for (const [caseIndex, entry] of (result.cases ?? []).entries()) {
      if (entry.trials?.length !== thresholdEvaluation.trials) {
        errors.push(`$.cases[${caseIndex}].trials: count does not match threshold provenance.`);
      }
    }
  } else if (result.adapter !== undefined) {
    errors.push('$.adapter: adapter identity is only embedded when thresholds are evaluated.');
  }
  return errors;
}

function validateExecution(execution, catalogNames) {
  if (!execution || !Array.isArray(execution.selectedSkills)) {
    throw new Error('Routing adapter must return selectedSkills.');
  }
  if (new Set(execution.selectedSkills).size !== execution.selectedSkills.length) {
    throw new Error('Routing adapter returned duplicate skill names.');
  }
  for (const skill of execution.selectedSkills) {
    if (!catalogNames.has(skill)) throw new Error(`Routing adapter selected an unknown skill: ${skill}.`);
  }
  for (const field of ['inputTokens', 'outputTokens']) {
    if (!Number.isSafeInteger(execution[field]) || execution[field] < 0) {
      throw new Error(`Routing adapter ${field} must be a non-negative safe integer.`);
    }
  }
  if (!Number.isFinite(execution.durationMs) || execution.durationMs < 0) {
    throw new Error('Routing adapter durationMs must be a non-negative finite number.');
  }
  if (!Number.isSafeInteger(execution.inputTokens + execution.outputTokens)) {
    throw new Error('Routing adapter token total must be a non-negative safe integer.');
  }
}

function emptyMetrics() {
  return {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    collisions: 0,
    trials: 0,
    durationMs: 0,
    tokens: { input: 0, output: 0, total: 0 },
  };
}

function addTrial(metrics, trial) {
  metrics.truePositives += trial.truePositives;
  metrics.falsePositives += trial.falsePositives;
  metrics.falseNegatives += trial.falseNegatives;
  metrics.collisions += trial.collision ? 1 : 0;
  metrics.trials += 1;
  metrics.durationMs += trial.durationMs;
  metrics.tokens.input += trial.tokens.input;
  metrics.tokens.output += trial.tokens.output;
  metrics.tokens.total += trial.tokens.total;
}

function finalize(metrics) {
  const precisionDenominator = metrics.truePositives + metrics.falsePositives;
  const recallDenominator = metrics.truePositives + metrics.falseNegatives;
  return {
    ...metrics,
    precision: precisionDenominator === 0 ? 0 : metrics.truePositives / precisionDenominator,
    recall: recallDenominator === 0 ? 0 : metrics.truePositives / recallDenominator,
    collisionRate: metrics.trials === 0 ? 0 : metrics.collisions / metrics.trials,
  };
}

export async function runRoutingEvaluation({
  suite,
  catalog,
  execute,
  tempRoot = resolve('tmp', 'routing-evaluations'),
  generatedAt = new Date().toISOString(),
  thresholdPolicy = null,
  thresholdPolicySha256,
  suiteSha256 = sha256(JSON.stringify(suite)),
  adapter,
}) {
  if (thresholdPolicy) {
    const thresholdErrors = thresholdContextErrors(thresholdPolicy, {
      suite,
      suiteSha256,
      adapter,
      generatedAt,
    });
    if (thresholdErrors.length > 0) {
      throw new Error(`Routing threshold policy is invalid:\n${thresholdErrors.join('\n')}`);
    }
    if (!adapter) throw new Error('Routing thresholds require an explicit adapter and model identity.');
  }
  mkdirSync(tempRoot, { recursive: true });
  const catalogNames = new Set(catalog.map((skill) => skill.name));
  const summaries = {
    overall: emptyMetrics(),
    training: emptyMetrics(),
    validation: emptyMetrics(),
  };
  const confusion = {};
  const cases = [];

  for (const routingCase of suite.cases) {
    const expected = new Set(routingCase.expected);
    const excluded = new Set(routingCase.excluded);
    const trials = [];
    let activated = 0;
    for (let trial = 1; trial <= suite.trials; trial += 1) {
      const workspace = mkdtempSync(resolve(tempRoot, `${routingCase.id}-${trial}-`));
      try {
        const execution = await execute({
          case: routingCase,
          trial,
          workspace,
          catalog,
        });
        validateExecution(execution, catalogNames);
        const selected = new Set(execution.selectedSkills);
        const truePositives = [...selected].filter((skill) => expected.has(skill)).length;
        const falsePositives = [...selected].filter((skill) => !expected.has(skill)).length;
        const falseNegatives = [...expected].filter((skill) => !selected.has(skill)).length;
        const collision = falsePositives > 0;
        const allExpectedSelected = [...expected].every((skill) => selected.has(skill));
        if (allExpectedSelected) activated += 1;
        const trialResult = {
          trial,
          selectedSkills: execution.selectedSkills,
          truePositives,
          falsePositives,
          falseNegatives,
          collision,
          durationMs: execution.durationMs,
          tokens: {
            input: execution.inputTokens,
            output: execution.outputTokens,
            total: execution.inputTokens + execution.outputTokens,
          },
        };
        trials.push(trialResult);
        addTrial(summaries.overall, trialResult);
        addTrial(summaries[routingCase.split], trialResult);
        for (const expectedSkill of expected) {
          confusion[expectedSkill] ??= {};
          for (const selectedSkill of selected) {
            if (expected.has(selectedSkill)) continue;
            confusion[expectedSkill][selectedSkill] = (confusion[expectedSkill][selectedSkill] ?? 0) + 1;
          }
        }
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
    cases.push({
      id: routingCase.id,
      split: routingCase.split,
      promptSha256: sha256(routingCase.prompt),
      expected: routingCase.expected,
      excluded: routingCase.excluded,
      activationRate: activated / suite.trials,
      trials,
    });
  }

  const summary = {
    overall: finalize(summaries.overall),
    training: finalize(summaries.training),
    validation: finalize(summaries.validation),
  };
  const thresholds = thresholdPolicy ? {
    policySha256: thresholdPolicySha256 ?? sha256(JSON.stringify(thresholdPolicy)),
    suiteSha256: thresholdPolicy.suiteSha256,
    sourceResultSha256: thresholdPolicy.sourceResultSha256,
    measuredAt: thresholdPolicy.measuredAt,
    trials: thresholdPolicy.trials,
    adapter: { ...thresholdPolicy.adapter },
    measured: { ...thresholdPolicy.measured },
    limits: { ...thresholdPolicy.thresholds },
    observed: {
      validationRecall: summary.validation.recall,
      overallPrecision: summary.overall.precision,
      overallCollisionRate: summary.overall.collisionRate,
    },
    passed: summary.validation.recall >= thresholdPolicy.thresholds.minimumValidationRecall
      && summary.overall.precision >= thresholdPolicy.thresholds.minimumOverallPrecision
      && summary.overall.collisionRate <= thresholdPolicy.thresholds.maximumOverallCollisionRate,
  } : null;

  return {
    schemaVersion: 1,
    suite: suite.name,
    generatedAt,
    ...(thresholdPolicy ? { adapter: { ...adapter } } : {}),
    thresholds,
    cases,
    confusion,
    summary,
  };
}