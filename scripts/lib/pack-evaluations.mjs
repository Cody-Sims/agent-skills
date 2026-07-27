import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { validateAgainstSchema } from './jsonschema.mjs';
import { sha256 } from './paths.mjs';
import { runJsonAdapterAsync } from './process-adapter.mjs';

const MAX_COUNTER = 1_000_000_000;

export function createPackProcessExecutor({
  command,
  args,
  environmentNames,
  timeoutMs,
  processAdapterOptions = {},
}) {
  return async ({ request, workspace, environment }) => {
    const { response, durationMs } = await runJsonAdapterAsync({
      ...processAdapterOptions,
      command,
      args,
      cwd: workspace,
      request,
      timeoutMs,
      environmentNames,
      environment,
      label: `Pack composition adapter for ${request.pack.name}/${request.caseId}/trial-${request.trial}`,
    });
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw new Error('Pack composition adapter returned a non-object response.');
    }
    const keys = Object.keys(response).sort();
    if (keys.join(',') !== 'inputTokens,outputTokens,selectedSkills') {
      throw new Error('Pack composition adapter returned an invalid response shape; output suppressed.');
    }
    return {
      selectedSkills: response.selectedSkills,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      durationMs,
    };
  };
}

function exactPack(registry, name) {
  return (registry.packs ?? []).find((entry) => entry.name === name);
}

function packBinding(pack) {
  return {
    name: pack.name,
    version: pack.version,
    members: pack.skills.map(({ name, version }) => ({ name, version })),
    handoffs: pack.handoffs.map(({ from, to }) => ({ from, to })),
  };
}

function definitionDigest(binding) {
  return sha256(JSON.stringify(binding));
}

function duplicates(items) {
  return items.filter((item, index) => items.indexOf(item) !== index);
}

export function adapterCatalog(pack, registry) {
  return pack.skills.map((member) => {
    const skill = registry.skills.find((entry) =>
      entry.name === member.name && entry.version === member.version);
    if (!skill) throw new Error(`Pack member ${member.name}@${member.version} is absent from registry v5.`);
    return {
      name: skill.name,
      version: skill.version,
      description: skill.description,
      discovery: skill.discovery,
    };
  });
}

export function computePackContext({ root, pack, registry }) {
  const catalog = adapterCatalog(pack, registry);
  let instructionBytes = 0;
  let resourceBytes = 0;
  for (const member of pack.skills) {
    const skill = registry.skills.find((entry) =>
      entry.name === member.name && entry.version === member.version);
    instructionBytes += readFileSync(resolve(root, skill.skillFile)).byteLength;
    for (const resource of skill.resources ?? []) {
      resourceBytes += readFileSync(resolve(root, skill.path, resource)).byteLength;
    }
  }
  return {
    memberCount: pack.skills.length,
    discoveryMetadataBytes: Buffer.byteLength(JSON.stringify(catalog), 'utf8'),
    instructionBytes,
    resourceBytes,
  };
}

function memberResourcePaths(pack, registry) {
  const paths = [];
  for (const member of pack.skills) {
    const skill = registry.skills.find((entry) =>
      entry.name === member.name && entry.version === member.version);
    if (!skill) throw new Error(`Pack member ${member.name}@${member.version} is absent from registry v5.`);
    paths.push(skill.skillFile);
    for (const resource of skill.resources ?? []) paths.push(`${skill.path}/${resource}`);
  }
  return paths.sort();
}

export function computeMemberTreeDigestFromReader({ pack, registry, readResource }) {
  const records = memberResourcePaths(pack, registry).map((relativePath) => {
    const content = readResource(relativePath);
    return `${Buffer.byteLength(relativePath, 'utf8')}:${relativePath}:${sha256(content)}\n`;
  });
  return sha256(records.join(''));
}

export function computeMemberTreeDigest({ root, pack, registry }) {
  return computeMemberTreeDigestFromReader({
    pack,
    registry,
    readResource: (relativePath) => readFileSync(resolve(root, relativePath)),
  });
}

export function validatePackSuite(schema, suite, {
  root,
  registryBytes,
  registry,
} = {}) {
  const errors = validateAgainstSchema(schema, suite);
  if (errors.length > 0 || !suite || !registry) return errors;
  if (registry?.schemaVersion !== 5) errors.push('$.source.registrySha256: pack suites require registry schema version 5.');
  if (registryBytes && suite.source.registrySha256 !== sha256(registryBytes)) {
    errors.push('$.source.registrySha256: digest does not match complete registry v5 bytes.');
  }
  const pack = exactPack(registry, suite.pack.name);
  if (!pack) return [...errors, `$.pack.name: unknown pack ${suite.pack.name}.`];
  const expectedBinding = packBinding(pack);
  if (root && suite.source.memberTreeSha256 !== computeMemberTreeDigest({ root, pack, registry })) {
    errors.push('$.source.memberTreeSha256: digest does not match the complete current member tree.');
  }
  if (suite.pack.version !== expectedBinding.version) errors.push('$.pack.version: version does not match pack definition.');
  if (!isDeepStrictEqual(suite.pack.members, expectedBinding.members)) {
    errors.push('$.pack.members: exact names and versions do not match pack definition.');
  }
  if (!isDeepStrictEqual(suite.pack.handoffs, expectedBinding.handoffs)) {
    errors.push('$.pack.handoffs: ordered handoffs do not match pack definition.');
  }
  const memberNames = new Set(expectedBinding.members.map(({ name }) => name));
  const ids = new Set();
  let hasTraining = false;
  let hasValidation = false;
  let hasNegative = false;
  for (const [index, entry] of suite.cases.entries()) {
    if (ids.has(entry.id)) errors.push(`$.cases[${index}].id: duplicate case ID ${entry.id}.`);
    ids.add(entry.id);
    hasTraining ||= entry.split === 'training';
    hasValidation ||= entry.split === 'validation';
    hasNegative ||= entry.kind === 'negative';
    for (const duplicate of new Set(duplicates(entry.excluded))) {
      errors.push(`$.cases[${index}].excluded: duplicate member ${duplicate}.`);
    }
    for (const name of [...entry.expected, ...entry.excluded]) {
      if (!memberNames.has(name)) errors.push(`$.cases[${index}]: route ${name} is outside the exact pack members.`);
    }
    if (entry.kind === 'negative' && entry.expected.length !== 0) {
      errors.push(`$.cases[${index}].expected: negative cases cannot expect a pack member.`);
    }
    if (entry.kind === 'negative' && entry.handoff !== null) {
      errors.push(`$.cases[${index}].handoff: negative cases require null.`);
    }
    if (entry.kind !== 'negative' && entry.expected.length !== 1) {
      errors.push(`$.cases[${index}].expected: positive and near-miss cases require one member.`);
    }
    if (entry.kind !== 'negative'
        && (!entry.handoff || typeof entry.handoff !== 'object' || Array.isArray(entry.handoff))) {
      const firstMember = expectedBinding.handoffs[0]?.from;
      const isInitialPositive = entry.kind === 'positive' && entry.expected[0] === firstMember;
      if (!isInitialPositive) errors.push(`$.cases[${index}].handoff: this ${entry.kind} case requires a handoff object.`);
    }
    if (entry.expected.some((name) => entry.excluded.includes(name))) {
      errors.push(`$.cases[${index}]: a member cannot be both expected and excluded.`);
    }
  }
  if (!hasTraining) errors.push('$.cases: at least one training case is required.');
  if (!hasValidation) errors.push('$.cases: at least one validation case is required.');
  if (!hasNegative) errors.push('$.cases: at least one negative out-of-pack case is required.');
  for (const member of memberNames) {
    if (!suite.cases.some((entry) => entry.kind === 'positive' && entry.expected[0] === member)) {
      errors.push(`$.cases: pack member ${member} requires a realistic positive case.`);
    }
  }
  for (const [index, entry] of suite.cases.entries()) {
    if (entry.kind === 'negative'
        && (entry.excluded.length !== memberNames.size
          || entry.excluded.some((name) => !memberNames.has(name)))) {
      errors.push(`$.cases[${index}].excluded: negative cases must exclude every pack member.`);
    }
    if (!entry.handoff) continue;
    if (entry.kind === 'positive'
        && (entry.expected[0] !== entry.handoff.to || !entry.excluded.includes(entry.handoff.from))) {
      errors.push(`$.cases[${index}]: positive handoff ${entry.handoff.from}->${entry.handoff.to} must select the destination and exclude the source.`);
    }
    if (entry.kind === 'near-miss'
        && (entry.expected[0] !== entry.handoff.from || !entry.excluded.includes(entry.handoff.to))) {
      errors.push(`$.cases[${index}]: near-miss handoff ${entry.handoff.from}->${entry.handoff.to} must retain the source and exclude the destination.`);
    }
  }
  for (const handoff of expectedBinding.handoffs) {
    const atBoundary = suite.cases.filter((entry) => isDeepStrictEqual(entry.handoff, handoff));
    if (!atBoundary.some((entry) => entry.kind === 'positive')) {
      errors.push(`$.cases: handoff ${handoff.from}->${handoff.to} requires a positive case.`);
    }
    if (!atBoundary.some((entry) => entry.kind === 'near-miss')) {
      errors.push(`$.cases: handoff ${handoff.from}->${handoff.to} requires an adjacent near-miss case.`);
    }
  }
  return errors;
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

function finalized(metrics) {
  const precisionBase = metrics.truePositives + metrics.falsePositives;
  const recallBase = metrics.truePositives + metrics.falseNegatives;
  return {
    ...metrics,
    precision: precisionBase === 0 ? 0 : metrics.truePositives / precisionBase,
    recall: recallBase === 0 ? 0 : metrics.truePositives / recallBase,
    collisionRate: metrics.trials === 0 ? 0 : metrics.collisions / metrics.trials,
  };
}

function validateExecution(execution, members) {
  if (!execution || !Array.isArray(execution.selectedSkills)) {
    throw new Error('Pack adapter must return selectedSkills.');
  }
  if (execution.selectedSkills.length > members.size) throw new Error('Pack adapter returned too many selectedSkills.');
  if (new Set(execution.selectedSkills).size !== execution.selectedSkills.length) {
    throw new Error('Pack adapter returned duplicate skill names.');
  }
  for (const name of execution.selectedSkills) {
    if (!members.has(name)) throw new Error(`Pack adapter selected ${name} outside the exact pack catalog.`);
  }
  for (const field of ['inputTokens', 'outputTokens']) {
    if (!Number.isSafeInteger(execution[field]) || execution[field] < 0 || execution[field] > MAX_COUNTER) {
      throw new Error(`Pack adapter ${field} must be a non-negative safe integer no greater than ${MAX_COUNTER}.`);
    }
  }
  if (!Number.isFinite(execution.durationMs) || execution.durationMs < 0 || execution.durationMs > 600_000) {
    throw new Error('Pack adapter durationMs must be a finite number from 0 through 600000.');
  }
  if (!Number.isSafeInteger(execution.inputTokens + execution.outputTokens)
      || execution.inputTokens + execution.outputTokens > MAX_COUNTER) {
    throw new Error('Pack adapter token total must be a bounded safe integer.');
  }
}

function summarizeResultCases(cases) {
  const totals = { overall: emptyMetrics(), training: emptyMetrics(), validation: emptyMetrics() };
  const confusion = {};
  for (const entry of cases) {
    const expected = new Set(entry.expected);
    for (const trial of entry.trials) {
      addTrial(totals.overall, trial);
      addTrial(totals[entry.split], trial);
      for (const expectedName of expected) {
        confusion[expectedName] ??= {};
        for (const selected of trial.selectedSkills) {
          if (expected.has(selected)) continue;
          confusion[expectedName][selected] = (confusion[expectedName][selected] ?? 0) + 1;
        }
      }
    }
  }
  return {
    summary: {
      overall: finalized(totals.overall),
      training: finalized(totals.training),
      validation: finalized(totals.validation),
    },
    confusion,
  };
}

function handoffCoverage(suite) {
  return suite.pack.handoffs.map((handoff) => {
    const matching = suite.cases.filter((entry) => isDeepStrictEqual(entry.handoff, handoff));
    const positiveCases = matching.filter(({ kind }) => kind === 'positive').map(({ id }) => id);
    const nearMissCases = matching.filter(({ kind }) => kind === 'near-miss').map(({ id }) => id);
    return {
      ...handoff,
      positiveCases,
      nearMissCases,
      covered: positiveCases.length > 0 && nearMissCases.length > 0,
    };
  });
}

export async function runPackEvaluation({
  root,
  suite,
  suiteBytes,
  registry,
  registryBytes,
  pack = exactPack(registry, suite.pack.name),
  adapter,
  provenance = {
    mode: 'structural',
    valid: false,
    sourceCommit: null,
    allowAncestor: false,
  },
  execute,
  tempRoot = resolve(root, 'tmp', 'pack-evaluations', 'work'),
  generatedAt = new Date().toISOString(),
}) {
  const catalog = adapterCatalog(pack, registry);
  const members = new Set(catalog.map(({ name }) => name));
  const cases = [];
  mkdirSync(tempRoot, { recursive: true });
  for (const suiteCase of suite.cases) {
    const expected = new Set(suiteCase.expected);
    let activations = 0;
    const trials = [];
    for (let trial = 1; trial <= suite.trials; trial += 1) {
      const trialRoot = mkdtempSync(resolve(tempRoot, `${suiteCase.id}-${trial}-`));
      const workspace = resolve(trialRoot, 'workspace');
      const home = resolve(trialRoot, 'home');
      const config = resolve(trialRoot, 'config');
      const cache = resolve(trialRoot, 'cache');
      const temp = resolve(trialRoot, 'tmp');
      for (const directory of [workspace, home, config, cache, temp]) mkdirSync(directory, { recursive: true });
      const environment = {
        HOME: home,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: cache,
        TMPDIR: temp,
        TEMP: temp,
        TMP: temp,
      };
      let preserveRoot = false;
      try {
        const request = {
          protocolVersion: 1,
          suite: { name: suite.name, version: suite.version },
          pack: { name: pack.name, version: pack.version },
          caseId: suiteCase.id,
          prompt: suiteCase.prompt,
          trial,
          catalog,
        };
        const execution = await execute({ request, workspace, environment });
        validateExecution(execution, members);
        const selected = new Set(execution.selectedSkills);
        const truePositives = [...selected].filter((name) => expected.has(name)).length;
        const falsePositives = [...selected].filter((name) => !expected.has(name)).length;
        const falseNegatives = [...expected].filter((name) => !selected.has(name)).length;
        const correct = selected.size === expected.size
          && [...expected].every((name) => selected.has(name))
          && !suiteCase.excluded.some((name) => selected.has(name));
        if (suiteCase.kind === 'negative'
          ? selected.size > 0
          : [...expected].every((name) => selected.has(name))) activations += 1;
        trials.push({
          trial,
          selectedSkills: execution.selectedSkills,
          truePositives,
          falsePositives,
          falseNegatives,
          collision: falsePositives > 0,
          correct,
          durationMs: execution.durationMs,
          tokens: {
            input: execution.inputTokens,
            output: execution.outputTokens,
            total: execution.inputTokens + execution.outputTokens,
          },
        });
      } catch (error) {
        if (error?.cleanupUncertain) {
          preserveRoot = true;
          error.preservedWorkspace = trialRoot;
          error.message = `${error.message} Temporary workspace preserved at ${trialRoot} for operator cleanup.`;
        }
        throw error;
      } finally {
        if (!preserveRoot) rmSync(trialRoot, { recursive: true, force: true });
      }
    }
    cases.push({
      id: suiteCase.id,
      split: suiteCase.split,
      kind: suiteCase.kind,
      promptSha256: sha256(suiteCase.prompt),
      expected: suiteCase.expected,
      excluded: suiteCase.excluded,
      handoff: suiteCase.handoff,
      activationRate: activations / suite.trials,
      trials,
    });
  }
  const calculated = summarizeResultCases(cases);
  const allCorrect = cases.every((entry) => entry.trials.every(({ correct }) => correct));
  const context = computePackContext({ root, pack, registry });
  context.adapterInputTokens = calculated.summary.overall.tokens.input;
  const binding = packBinding(pack);
  return {
    schemaVersion: 1,
    suite: {
      name: suite.name,
      version: suite.version,
      path: suite.source.suitePath,
      bytes: suiteBytes.byteLength,
      sha256: sha256(suiteBytes),
    },
    registry: {
      schemaVersion: registry.schemaVersion,
      bytes: registryBytes.byteLength,
      sha256: sha256(registryBytes),
    },
    sourceCommit: provenance.sourceCommit,
    provenance: {
      mode: provenance.mode,
      valid: provenance.valid,
      allowAncestor: provenance.allowAncestor,
    },
    pack: {
      ...binding,
      definitionSha256: definitionDigest(binding),
      memberTreeSha256: computeMemberTreeDigest({ root, pack, registry }),
    },
    adapter,
    evidence: adapter.kind === 'fixture'
      ? {
        kind: 'fixture',
        label: provenance.valid
          ? 'Deterministic fixture evidence with verified source provenance; no vendor host executed and not promotion evidence.'
          : 'Structural precommit fixture evidence; source provenance was not verified, no vendor host executed, and not promotion evidence.',
        vendorHostExecuted: false,
        promotionEligible: false,
      }
      : {
        kind: 'host',
        label: 'Hosted adapter evidence; promotion eligibility requires separately established thresholds.',
        vendorHostExecuted: true,
        promotionEligible: false,
      },
    generatedAt,
    thresholds: null,
    context,
    cases,
    confusion: calculated.confusion,
    handoffCoverage: handoffCoverage(suite),
    summary: calculated.summary,
    status: allCorrect ? 'pass' : 'fail',
    reason: allCorrect ? null : 'One or more trials did not select the exact expected routes or selected an excluded route.',
  };
}

export function validatePackResult(schema, result, {
  root,
  suite,
  suiteBytes,
  registry,
  registryBytes,
  pack = exactPack(registry, suite.pack.name),
  adapter,
  provenance = {
    mode: 'structural',
    valid: false,
    sourceCommit: null,
    allowAncestor: false,
  },
} = {}) {
  const errors = validateAgainstSchema(schema, result);
  if (errors.length > 0) return errors;
  if (result.suite.name !== suite.name || result.suite.version !== suite.version
      || result.suite.path !== suite.source.suitePath
      || result.suite.bytes !== suiteBytes.byteLength || result.suite.sha256 !== sha256(suiteBytes)) {
    errors.push('$.suite: identity, complete byte count, or digest is stale or tampered.');
  }
  if (result.registry.schemaVersion !== registry.schemaVersion
      || result.registry.bytes !== registryBytes.byteLength
      || result.registry.sha256 !== sha256(registryBytes)) {
    errors.push('$.registry: registry v5 byte count or digest is stale or tampered.');
  }
  if (result.sourceCommit !== provenance.sourceCommit
      || result.provenance.mode !== provenance.mode
      || result.provenance.valid !== provenance.valid
      || result.provenance.allowAncestor !== provenance.allowAncestor) {
    errors.push('$.provenance: result does not match externally supplied provenance context.');
  }
  if (provenance.mode === 'structural'
      && (provenance.valid || provenance.sourceCommit !== null || provenance.allowAncestor)) {
    errors.push('$.provenance: structural mode cannot claim a source commit, ancestry policy, or valid provenance.');
  }
  if (provenance.mode === 'provenance'
      && (!provenance.valid || !/^[0-9a-f]{40}$/.test(provenance.sourceCommit ?? ''))) {
    errors.push('$.provenance: provenance mode requires a verified external full commit SHA.');
  }
  const binding = packBinding(pack);
  if (!isDeepStrictEqual({
    name: result.pack.name,
    version: result.pack.version,
    members: result.pack.members,
    handoffs: result.pack.handoffs,
  }, binding) || result.pack.definitionSha256 !== definitionDigest(binding)) {
    errors.push('$.pack: pack definition, member versions, handoffs, or digest is stale or tampered.');
  }
  const memberTreeSha256 = computeMemberTreeDigest({ root, pack, registry });
  if (result.pack.memberTreeSha256 !== memberTreeSha256
      || suite.source.memberTreeSha256 !== memberTreeSha256) {
    errors.push('$.pack.memberTreeSha256: complete member tree is stale or tampered.');
  }
  const suiteAdapterBinding = {
    id: result.adapter.id,
    kind: result.adapter.kind,
    entrypointSha256: result.adapter.entrypointSha256,
    policySha256: result.adapter.policySha256,
    launchPolicySha256: result.adapter.launchPolicySha256,
  };
  if (!isDeepStrictEqual(result.adapter, adapter) || !isDeepStrictEqual(suiteAdapterBinding, suite.adapter)) {
    errors.push('$.adapter: adapter identity or launch policy is stale or tampered.');
  }
  const expectedContext = computePackContext({ root, pack, registry });
  expectedContext.adapterInputTokens = result.summary.overall.tokens.input;
  if (!isDeepStrictEqual(result.context, expectedContext)) {
    errors.push('$.context: measured bytes or adapter input-token counter is inconsistent.');
  }
  if (result.cases.length !== suite.cases.length) {
    errors.push('$.cases: result does not bind every suite case.');
  } else {
    for (const [index, entry] of result.cases.entries()) {
      const source = suite.cases[index];
      if (entry.id !== source.id || entry.split !== source.split || entry.kind !== source.kind
          || entry.promptSha256 !== sha256(source.prompt)
          || !isDeepStrictEqual(entry.expected, source.expected)
          || !isDeepStrictEqual(entry.excluded, source.excluded)
          || !isDeepStrictEqual(entry.handoff, source.handoff)
          || entry.trials.length !== suite.trials) {
        errors.push(`$.cases[${index}]: case binding is stale or tampered.`);
      }
      const expected = new Set(entry.expected);
      let activations = 0;
      for (const [trialIndex, trial] of entry.trials.entries()) {
        const selected = new Set(trial.selectedSkills);
        const tp = [...selected].filter((name) => expected.has(name)).length;
        const fp = [...selected].filter((name) => !expected.has(name)).length;
        const fn = [...expected].filter((name) => !selected.has(name)).length;
        const correct = selected.size === expected.size
          && [...expected].every((name) => selected.has(name))
          && !entry.excluded.some((name) => selected.has(name));
        if (trial.trial !== trialIndex + 1 || trial.truePositives !== tp
            || trial.falsePositives !== fp || trial.falseNegatives !== fn
            || trial.collision !== (fp > 0)
            || trial.correct !== correct
            || trial.tokens.total !== trial.tokens.input + trial.tokens.output) {
          errors.push(`$.cases[${index}].trials[${trialIndex}]: counters are inconsistent.`);
        }
        if (entry.kind === 'negative'
          ? selected.size > 0
          : [...expected].every((name) => selected.has(name))) activations += 1;
      }
      if (entry.activationRate !== activations / entry.trials.length) {
        errors.push(`$.cases[${index}].activationRate: rate is inconsistent.`);
      }
    }
  }
  const calculated = summarizeResultCases(result.cases);
  if (!isDeepStrictEqual(result.summary, calculated.summary)) errors.push('$.summary: summary is inconsistent with trials.');
  if (!isDeepStrictEqual(result.confusion, calculated.confusion)) errors.push('$.confusion: matrix is inconsistent with trials.');
  if (!isDeepStrictEqual(result.handoffCoverage, handoffCoverage(suite))) {
    errors.push('$.handoffCoverage: coverage is inconsistent with the suite.');
  }
  if (result.thresholds !== null || result.evidence.promotionEligible) {
    errors.push('$.thresholds: hosted composition thresholds remain disabled pending real baselines.');
  }
  const allCorrect = result.cases.every((entry) => entry.trials.every(({ correct }) => correct));
  const expectedStatus = allCorrect ? 'pass' : 'fail';
  if (result.status !== expectedStatus) errors.push('$.status: status does not match recomputed trial correctness.');
  if (result.status === 'pass' && result.reason !== null) errors.push('$.reason: passing results require a null reason.');
  if (result.status === 'fail' && !result.reason) errors.push('$.reason: failing results require a reason.');
  if (result.status === 'skip') errors.push('$.status: completed composition result cannot be skip.');
  return errors;
}
