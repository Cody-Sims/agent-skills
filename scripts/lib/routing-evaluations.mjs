import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { sha256 } from './paths.mjs';
import { validateAgainstSchema } from './jsonschema.mjs';

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

export function validateRoutingResult(schema, result) {
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
}) {
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

  return {
    schemaVersion: 1,
    suite: suite.name,
    generatedAt,
    thresholds: null,
    cases,
    confusion,
    summary: {
      overall: finalize(summaries.overall),
      training: finalize(summaries.training),
      validation: finalize(summaries.validation),
    },
  };
}