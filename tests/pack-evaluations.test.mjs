import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  computePackContext,
  computeMemberTreeDigest,
  createPackProcessExecutor,
  runPackEvaluation,
  validatePackResult,
  validatePackSuite,
} from '../scripts/lib/pack-evaluations.mjs';
import { sha256 } from '../scripts/lib/paths.mjs';
import {
  adapterLaunchDigests,
  normalizeSafeAdapterLaunch,
} from '../scripts/lib/safe-adapter-launch.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const HASH = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

function fixture() {
  const root = makeTempDir('pack-evaluation-');
  mkdirSync(resolve(root, 'skills/alpha/references'), { recursive: true });
  mkdirSync(resolve(root, 'skills/beta'), { recursive: true });
  writeFileSync(resolve(root, 'skills/alpha/SKILL.md'), 'α instructions\n');
  writeFileSync(resolve(root, 'skills/alpha/references/detail.md'), 'resource α\n');
  writeFileSync(resolve(root, 'skills/beta/SKILL.md'), 'beta instructions\n');
  const pack = {
    name: 'sample-pack',
    version: '1.0.0',
    skills: [
      { name: 'alpha', version: '1.0.0' },
      { name: 'beta', version: '2.0.0' },
    ],
    handoffs: [{ from: 'alpha', to: 'beta', when: 'Alpha work is complete.' }],
  };
  const registry = {
    schemaVersion: 5,
    skills: [
      {
        name: 'alpha',
        version: '1.0.0',
        description: 'Handles initial work.',
        discovery: { category: 'workflow', tags: ['initial'] },
        path: 'skills/alpha',
        skillFile: 'skills/alpha/SKILL.md',
        resources: ['references/detail.md'],
      },
      {
        name: 'beta',
        version: '2.0.0',
        description: 'Handles final work.',
        discovery: { category: 'workflow', tags: ['final'] },
        path: 'skills/beta',
        skillFile: 'skills/beta/SKILL.md',
        resources: [],
      },
    ],
    packs: [pack],
  };
  const registryBytes = Buffer.from(`${JSON.stringify(registry)}\n`);
  const suiteAdapter = {
    id: 'fixture-router-v1',
    kind: 'fixture',
    entrypointSha256: HASH,
    policySha256: 'c'.repeat(64),
    launchPolicySha256: 'd'.repeat(64),
  };
  const adapter = { ...suiteAdapter, launchSha256: 'e'.repeat(64) };
  const memberTreeSha256 = computeMemberTreeDigest({ root, pack, registry });
  const suite = {
    schemaVersion: 1,
    name: 'sample-pack-composition',
    version: '1.0.0',
    source: {
      registrySha256: sha256(registryBytes),
      memberTreeSha256,
      suitePath: 'evals/packs/sample-pack.json',
    },
    pack: {
      name: pack.name,
      version: pack.version,
      members: pack.skills,
      handoffs: [{ from: 'alpha', to: 'beta' }],
    },
    adapter: suiteAdapter,
    trials: 2,
    thresholds: null,
    cases: [
      {
        id: 'alpha-positive',
        split: 'training',
        kind: 'positive',
        prompt: 'Clarify the initial request.',
        expected: ['alpha'],
        excluded: ['beta'],
        handoff: null,
      },
      {
        id: 'beta-handoff-positive',
        split: 'validation',
        kind: 'positive',
        prompt: 'The initial work is complete; perform the final work.',
        expected: ['beta'],
        excluded: ['alpha'],
        handoff: { from: 'alpha', to: 'beta' },
      },
      {
        id: 'adjacent-near-miss',
        split: 'validation',
        kind: 'near-miss',
        prompt: 'Initial work is not approved yet; do not start final work.',
        expected: ['alpha'],
        excluded: ['beta'],
        handoff: { from: 'alpha', to: 'beta' },
      },
      {
        id: 'out-of-pack',
        split: 'validation',
        kind: 'negative',
        prompt: 'Deploy the application.',
        expected: [],
        excluded: ['alpha', 'beta'],
        handoff: null,
      },
    ],
  };
  const suiteBytes = Buffer.from(`${JSON.stringify(suite)}\n`);
  const provenance = {
    mode: 'provenance',
    valid: true,
    sourceCommit: COMMIT,
    allowAncestor: false,
  };
  return { root, pack, registry, registryBytes, adapter, suite, suiteBytes, provenance };
}

test('pack suite schema is strict and semantic validation binds members and covers handoffs', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/pack-suite.schema.json'), 'utf8'));
  const value = fixture();
  try {
    assert.deepEqual(validatePackSuite(schema, value.suite, {
      suiteBytes: value.suiteBytes,
      registryBytes: value.registryBytes,
      registry: value.registry,
      sourceCommit: COMMIT,
    }), []);
    const extra = structuredClone(value.suite);
    extra.untrusted = true;
    assert.match(validatePackSuite(schema, extra, {
      suiteBytes: Buffer.from(JSON.stringify(extra)),
      registryBytes: value.registryBytes,
      registry: value.registry,
      sourceCommit: COMMIT,
    }).join('\n'), /unknown property/);
    const missingHandoff = structuredClone(value.suite);
    missingHandoff.cases = missingHandoff.cases.map((entry) => ({ ...entry, handoff: null }));
    assert.match(validatePackSuite(schema, missingHandoff, {
      suiteBytes: Buffer.from(JSON.stringify(missingHandoff)),
      registryBytes: value.registryBytes,
      registry: value.registry,
      sourceCommit: COMMIT,
    }).join('\n'), /handoff.*positive|positive.*handoff/);
    const wrongMember = structuredClone(value.suite);
    wrongMember.pack.members[1].version = '9.0.0';
    assert.match(validatePackSuite(schema, wrongMember, {
      suiteBytes: Buffer.from(JSON.stringify(wrongMember)),
      registryBytes: value.registryBytes,
      registry: value.registry,
      sourceCommit: COMMIT,
    }).join('\n'), /members.*pack definition/);
    const reversedNearMiss = structuredClone(value.suite);
    reversedNearMiss.cases[2].expected = ['beta'];
    reversedNearMiss.cases[2].excluded = ['alpha'];
    assert.match(validatePackSuite(schema, reversedNearMiss, {
      suiteBytes: Buffer.from(JSON.stringify(reversedNearMiss)),
      registryBytes: value.registryBytes,
      registry: value.registry,
      sourceCommit: COMMIT,
    }).join('\n'), /near-miss.*alpha.*beta/);
  } finally {
    removeDir(value.root);
  }
});

test('runner exposes only exact pack catalog and omits expected answers', async () => {
  const value = fixture();
  try {
    const requests = [];
    await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async ({ request }) => {
        requests.push(request);
        return { selectedSkills: [], inputTokens: 3, outputTokens: 1, durationMs: 2 };
      },
    });
    assert.equal(requests.length, value.suite.cases.length * value.suite.trials);
    for (const request of requests) {
      assert.deepEqual(request.catalog.map(({ name }) => name), ['alpha', 'beta']);
      assert.equal('expected' in request, false);
      assert.equal('excluded' in request, false);
      assert.equal('kind' in request, false);
      assert.equal('handoff' in request, false);
    }
  } finally {
    removeDir(value.root);
  }
});

test('runner rejects out-of-pack routes and unsafe adapter counters', async () => {
  const value = fixture();
  try {
    await assert.rejects(() => runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async () => ({ selectedSkills: ['outside'], inputTokens: 1, outputTokens: 1, durationMs: 1 }),
    }), /outside the exact pack catalog/);
    await assert.rejects(() => runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async () => ({
        selectedSkills: ['alpha'],
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 1,
        durationMs: 1,
      }),
    }), /safe integer/);
  } finally {
    removeDir(value.root);
  }
});

test('status is bound to exact expected routes and excluded-route avoidance', async () => {
  const value = fixture();
  try {
    const expectedByCase = new Map(value.suite.cases.map((entry) => [entry.id, entry.expected]));
    const passing = await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async ({ request }) => ({
        selectedSkills: expectedByCase.get(request.caseId),
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
      }),
    });
    assert.equal(passing.status, 'pass');
    assert.ok(passing.cases.every((entry) => entry.trials.every((trial) => trial.correct)));

    const failing = await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async ({ request }) => ({
        selectedSkills: request.caseId === 'adjacent-near-miss' ? ['beta'] : expectedByCase.get(request.caseId),
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
      }),
    });
    assert.equal(failing.status, 'fail');
    assert.match(failing.reason, /exact expected routes/i);
    const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/pack-result.schema.json'), 'utf8'));
    failing.status = 'pass';
    failing.reason = null;
    assert.match(validatePackResult(schema, failing, { ...value, sourceCommit: COMMIT }).join('\n'), /status.*correctness/i);
  } finally {
    removeDir(value.root);
  }
});

test('negative activation rate measures any selected pack member', async () => {
  const value = fixture();
  try {
    const expectedByCase = new Map(value.suite.cases.map((entry) => [entry.id, entry.expected]));
    const correct = await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async ({ request }) => ({
        selectedSkills: expectedByCase.get(request.caseId),
        inputTokens: 1,
        outputTokens: 0,
        durationMs: 1,
      }),
    });
    assert.equal(correct.cases.find(({ kind }) => kind === 'negative').activationRate, 0);
    const incorrect = await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async ({ request }) => ({
        selectedSkills: request.caseId === 'out-of-pack' ? ['alpha'] : expectedByCase.get(request.caseId),
        inputTokens: 1,
        outputTokens: 0,
        durationMs: 1,
      }),
    });
    assert.equal(incorrect.cases.find(({ kind }) => kind === 'negative').activationRate, 1);
    assert.equal(incorrect.status, 'fail');
  } finally {
    removeDir(value.root);
  }
});

test('handoff validation rejects malformed null, object, scalar, and extra fields by case kind', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/pack-suite.schema.json'), 'utf8'));
  const value = fixture();
  try {
    const mutations = [
      (suite) => { suite.cases[1].handoff = null; },
      (suite) => { suite.cases[1].handoff = {}; },
      (suite) => { suite.cases[1].handoff = 'alpha-to-beta'; },
      (suite) => { suite.cases[2].handoff.extra = true; },
      (suite) => { suite.cases[3].handoff = { from: 'alpha', to: 'beta' }; },
    ];
    for (const mutate of mutations) {
      const suite = structuredClone(value.suite);
      mutate(suite);
      assert.notDeepEqual(validatePackSuite(schema, suite, {
        registryBytes: value.registryBytes,
        registry: value.registry,
        sourceCommit: COMMIT,
      }), []);
    }
  } finally {
    removeDir(value.root);
  }
});

test('result computes validation confusion, handoff coverage, and deterministic context bytes', async () => {
  const value = fixture();
  try {
    const result = await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      generatedAt: '2026-07-27T12:00:00.000Z',
      execute: async ({ request }) => ({
        selectedSkills: request.caseId === 'adjacent-near-miss' ? ['beta'] : [],
        inputTokens: 3,
        outputTokens: 1,
        durationMs: 2,
      }),
    });
    assert.equal(result.summary.validation.falsePositives, 2);
    assert.equal(result.confusion.alpha.beta, 2);
    assert.deepEqual(result.handoffCoverage, [{
      from: 'alpha',
      to: 'beta',
      positiveCases: ['beta-handoff-positive'],
      nearMissCases: ['adjacent-near-miss'],
      covered: true,
    }]);
    const context = computePackContext({
      root: value.root,
      pack: value.pack,
      registry: value.registry,
    });
    assert.equal(result.context.memberCount, 2);
    assert.equal(result.context.discoveryMetadataBytes, context.discoveryMetadataBytes);
    assert.equal(result.context.instructionBytes, Buffer.byteLength('α instructions\n') + Buffer.byteLength('beta instructions\n'));
    assert.equal(result.context.resourceBytes, Buffer.byteLength('resource α\n'));
    assert.equal(result.context.adapterInputTokens, value.suite.cases.length * value.suite.trials * 3);
    assert.equal(result.evidence.kind, 'fixture');
    assert.equal(result.evidence.vendorHostExecuted, false);
    assert.equal(result.evidence.promotionEligible, false);
    assert.equal(result.thresholds, null);
  } finally {
    removeDir(value.root);
  }
});

test('result validation rejects stale bindings, tampering, and inconsistent summaries', async () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/pack-result.schema.json'), 'utf8'));
  const value = fixture();
  try {
    const result = await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async () => ({ selectedSkills: [], inputTokens: 1, outputTokens: 0, durationMs: 1 }),
    });
    const options = { ...value, sourceCommit: COMMIT };
    assert.deepEqual(validatePackResult(schema, result, options), []);
    for (const mutate of [
      (copy) => { copy.suite.sha256 = HASH; },
      (copy) => { copy.registry.sha256 = HASH; },
      (copy) => { copy.pack.version = '9.0.0'; },
      (copy) => { copy.pack.members[0].version = '9.0.0'; },
      (copy) => { copy.sourceCommit = 'c'.repeat(40); },
      (copy) => { copy.adapter.policySha256 = HASH; },
      (copy) => { copy.context.instructionBytes += 1; },
      (copy) => { copy.summary.validation.recall = 1; },
    ]) {
      const copy = structuredClone(result);
      mutate(copy);
      assert.notDeepEqual(validatePackResult(schema, copy, options), []);
    }
  } finally {
    removeDir(value.root);
  }
});

test('member provenance binds every sorted SKILL and resource byte', async () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/pack-result.schema.json'), 'utf8'));
  const value = fixture();
  try {
    const result = await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async ({ request }) => ({
        selectedSkills: value.suite.cases.find(({ id }) => id === request.caseId).expected,
        inputTokens: 1,
        outputTokens: 0,
        durationMs: 1,
      }),
    });
    assert.equal(result.pack.memberTreeSha256, value.suite.source.memberTreeSha256);
    assert.equal(result.suite.path, value.suite.source.suitePath);
    writeFileSync(resolve(value.root, 'skills/alpha/references/detail.md'), 'resource β\n');
    assert.equal(Buffer.byteLength('resource α\n'), Buffer.byteLength('resource β\n'));
    assert.match(validatePackResult(schema, result, {
      ...value,
      sourceCommit: COMMIT,
    }).join('\n'), /member tree/i);
  } finally {
    removeDir(value.root);
  }
});

test('pack subprocess failures are bounded and suppress untrusted stderr and secrets', async () => {
  const temp = makeTempDir('pack-adapter-failure-');
  try {
    const adapterPath = resolve(temp, 'adapter.mjs');
    writeFileSync(adapterPath, "process.stderr.write('TOP_SECRET_VALUE'); process.exit(2);\n");
    const execute = createPackProcessExecutor({
      command: process.execPath,
      args: [adapterPath],
      environmentNames: [],
      timeoutMs: 100,
    });
    await assert.rejects(
      () => execute({
        workspace: temp,
        request: {
          protocolVersion: 1,
          suite: { name: 'sample-pack-composition', version: '1.0.0' },
          pack: { name: 'sample-pack', version: '1.0.0' },
          caseId: 'sample-case',
          prompt: 'Route this.',
          trial: 1,
          catalog: [],
        },
      }),
      (error) => /stderr suppressed/.test(error.message) && !error.message.includes('TOP_SECRET_VALUE'),
    );
  } finally {
    removeDir(temp);
  }
});

test('each trial receives isolated home, config, cache, and temp directories', async () => {
  const value = fixture();
  try {
    const environments = [];
    await runPackEvaluation({
      ...value,
      sourceCommit: COMMIT,
      execute: async ({ environment }) => {
        for (const name of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'TEMP', 'TMP']) {
          assert.equal(existsSync(environment[name]), true);
        }
        environments.push(environment);
        return { selectedSkills: [], inputTokens: 1, outputTokens: 0, durationMs: 1 };
      },
    });
    assert.equal(environments.length, value.suite.cases.length * value.suite.trials);
    for (const environment of environments) {
      assert.notEqual(environment.HOME, process.env.HOME);
      for (const name of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'TEMP', 'TMP']) {
        assert.equal(typeof environment[name], 'string');
      }
      assert.equal('PACK_TEST_SECRET' in environment, false);
    }
  } finally {
    removeDir(value.root);
  }
});

test('cleanup deadline and persistent EPERM preserve pack trial workspaces', async () => {
  for (const state of ['gone', 'permission-denied']) {
    const value = fixture();
    try {
      const child = new EventEmitter();
      child.pid = 424_242;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      if (state === 'permission-denied') {
        queueMicrotask(() => {
          child.stdout.end('{}');
          child.emit('close', 0, null);
        });
      }
      const execute = createPackProcessExecutor({
        command: process.execPath,
        args: [resolve(value.root, 'adapter.mjs')],
        environmentNames: [],
        timeoutMs: 5,
        processAdapterOptions: {
          supervision: {
            spawn: () => child,
            processGroupState: () => state,
            terminateProcessGroup: () => {},
          },
          terminationGraceMs: 5,
          cleanupTimeoutMs: 30,
        },
      });
      let error;
      try {
        await runPackEvaluation({
          ...value,
          sourceCommit: COMMIT,
          execute,
        });
        assert.fail('expected cleanup uncertainty');
      } catch (caught) {
        error = caught;
      }
      assert.equal(error.cleanupUncertain, true);
      assert.match(error.message, /workspace preserved at/i);
      assert.equal(existsSync(error.preservedWorkspace), true);
    } finally {
      removeDir(value.root);
    }
  }
});

test('pack adapters bound timeout and output overflow and terminate surviving descendants', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Pack process-group supervision supports Darwin and Linux only.');
    return;
  }
  const temp = makeTempDir('pack-process-bounds-');
  try {
    const request = {
      protocolVersion: 1,
      suite: { name: 'sample-pack-composition', version: '1.0.0' },
      pack: { name: 'sample-pack', version: '1.0.0' },
      caseId: 'sample-case',
      prompt: 'Route this.',
      trial: 1,
      catalog: [],
    };
    const timeoutAdapter = resolve(temp, 'timeout.mjs');
    writeFileSync(timeoutAdapter, 'setTimeout(() => {}, 1000);\n');
    await assert.rejects(createPackProcessExecutor({
      command: process.execPath,
      args: [timeoutAdapter],
      environmentNames: [],
      timeoutMs: 20,
    })({ request, workspace: temp, environment: {} }), /timed out.*process group terminated/i);

    const overflowAdapter = resolve(temp, 'overflow.mjs');
    writeFileSync(overflowAdapter, "process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));\n");
    await assert.rejects(createPackProcessExecutor({
      command: process.execPath,
      args: [overflowAdapter],
      environmentNames: [],
      timeoutMs: 1000,
    })({ request, workspace: temp, environment: {} }), /output limit/i);

    const marker = resolve(temp, 'descendant-survived.txt');
    const child = resolve(temp, 'child.mjs');
    const parent = resolve(temp, 'parent.mjs');
    writeFileSync(child, [
      "import { writeFileSync } from 'node:fs';",
      "process.on('SIGTERM', () => {});",
      `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'survived'), 300);`,
      'setTimeout(() => {}, 600);',
    ].join('\n'));
    writeFileSync(parent, [
      "import { spawn } from 'node:child_process';",
      `spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'ignore' }).unref();`,
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      "process.stdout.write(JSON.stringify({ selectedSkills: [], inputTokens: 1, outputTokens: 0 }));",
    ].join('\n'));
    await createPackProcessExecutor({
      command: process.execPath,
      args: [parent],
      environmentNames: [],
      timeoutMs: 1000,
    })({ request, workspace: temp, environment: {} });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
    assert.equal(existsSync(marker), false, 'pack adapter descendant survived cleanup');
  } finally {
    removeDir(temp);
  }
});

test('shared launch contract rejects ignored entrypoints, shebangs, PATH, and loader environments', () => {
  const temp = makeTempDir('pack-launch-');
  try {
    const reviewed = resolve(temp, 'reviewed.mjs');
    const ignored = resolve(temp, 'ignored.mjs');
    const direct = resolve(temp, 'direct-adapter');
    writeFileSync(reviewed, 'process.exit(0);\n');
    writeFileSync(ignored, 'process.exit(0);\n');
    writeFileSync(direct, '#!/usr/bin/env node\nprocess.exit(0);\n');
    chmodSync(direct, 0o755);
    assert.throws(() => normalizeSafeAdapterLaunch({
      command: process.execPath,
      entrypoint: reviewed,
      args: [ignored, reviewed],
      environmentNames: [],
    }), /first script argument/i);
    assert.throws(() => normalizeSafeAdapterLaunch({
      command: direct,
      entrypoint: direct,
      args: [],
      environmentNames: [],
    }), /shebang/i);
    assert.throws(() => normalizeSafeAdapterLaunch({
      command: 'node',
      entrypoint: reviewed,
      args: [reviewed],
      environmentNames: [],
    }), /absolute|PATH/i);
    for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD']) {
      assert.throws(() => normalizeSafeAdapterLaunch({
        command: process.execPath,
        entrypoint: reviewed,
        args: [reviewed],
        environmentNames: [name],
      }), /forbidden adapter environment/i);
    }
  } finally {
    removeDir(temp);
  }
});

test('launch digests bind the actual normalized command, arguments, and environment policy', () => {
  const temp = makeTempDir('pack-launch-digest-');
  try {
    const reviewed = resolve(temp, 'reviewed.mjs');
    writeFileSync(reviewed, 'process.exit(0);\n');
    const normalized = normalizeSafeAdapterLaunch({
      command: process.execPath,
      entrypoint: reviewed,
      args: [reviewed, '--mode', 'fixture'],
      environmentNames: ['PACK_MODE'],
      maxArgs: 4,
    });
    assert.equal(normalized.command, process.execPath);
    assert.equal(normalized.args[0], reviewed);
    const original = adapterLaunchDigests(normalized);
    const changed = adapterLaunchDigests({ ...normalized, args: [...normalized.args, '--changed'] });
    assert.notEqual(original.launchSha256, changed.launchSha256);
    assert.notEqual(original.policySha256, changed.policySha256);
  } finally {
    removeDir(temp);
  }
});

test('committed suites cover every pack and deterministic CLI smoke writes valid fixture artifacts', () => {
  const execution = spawnSync('npm', ['run', 'pack:validate'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /3 pack composition suites/);

  const smoke = spawnSync('npm', ['run', 'pack:smoke'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.match(smoke.stdout, /fixture evidence/);
  for (const pack of ['feature-delivery', 'safe-refactor', 'release-readiness']) {
    const result = JSON.parse(readFileSync(resolve(REPO_ROOT, `tmp/pack-evaluations/${pack}.json`), 'utf8'));
    assert.equal(result.pack.name, pack);
    assert.equal(result.status, 'pass');
    assert.equal(result.evidence.kind, 'fixture');
    assert.equal(result.evidence.vendorHostExecuted, false);
    assert.equal(result.evidence.promotionEligible, false);
  }
  const artifactValidation = spawnSync('npm', [
    'run', 'pack:validate', '--',
    '--result', 'tmp/pack-evaluations/feature-delivery.json',
    '--result', 'tmp/pack-evaluations/safe-refactor.json',
    '--result', 'tmp/pack-evaluations/release-readiness.json',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(artifactValidation.status, 0, artifactValidation.stderr);
  assert.match(artifactValidation.stdout, /3 artifacts are valid/);
});
