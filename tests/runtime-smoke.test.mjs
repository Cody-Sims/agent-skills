import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { validateAgainstSchema } from '../scripts/lib/jsonschema.mjs';
import { runRuntimeSmokeSuite } from '../scripts/lib/runtime-smoke.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const RUNNER = resolve(REPO_ROOT, 'scripts/run-runtime-smoke.mjs');
const SUITE = resolve(REPO_ROOT, 'tests/fixtures/runtime-smoke/suite.json');
const ADAPTER = resolve(REPO_ROOT, 'tests/fixtures/runtime-smoke/adapter.mjs');
const RESULT_SCHEMA = resolve(REPO_ROOT, 'schemas/runtime-smoke-result.schema.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    ...options,
  });
}

function fixtureArguments(out) {
  return [
    '--suite', SUITE,
    '--out', out,
    '--timeout-ms', '5000',
    ...['claude-code', 'github-copilot', 'openai-codex'].flatMap((runtime) => [
      '--adapter', `${runtime}=${process.execPath}`,
      '--adapter-entrypoint', `${runtime}=${ADAPTER}`,
      '--adapter-arg', `${runtime}=${ADAPTER}`,
    ]),
  ];
}

test('runtime smoke CLI has concise non-interactive help', () => {
  const execution = run(['--help']);
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /--suite <path>/);
  assert.match(execution.stdout, /--out <path>/);
  assert.match(execution.stdout, /--adapter <runtime=command>/);
  assert.match(execution.stdout, /--adapter-entrypoint <runtime=path>/);
  assert.ok(execution.stdout.split('\n').length <= 18);
});

test('configured adapters require an explicit reviewed entrypoint', () => {
  const temp = makeTempDir('runtime-smoke-entrypoint-');
  try {
    const execution = run([
      '--suite', SUITE,
      '--out', resolve(temp, 'result.json'),
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-arg', `claude-code=${ADAPTER}`,
    ]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /adapter-entrypoint.*claude-code/i);
  } finally {
    removeDir(temp);
  }
});

test('reviewed entrypoint cannot be smuggled as an ignored argument', () => {
  const temp = makeTempDir('runtime-smoke-launch-shape-');
  try {
    const unrelated = resolve(temp, 'unrelated.mjs');
    const out = resolve(temp, 'result.json');
    writeFileSync(unrelated, [
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "process.stdout.write(JSON.stringify({ protocolVersion: 1, runtime: request.runtime, requestId: request.requestId, status: 'skip', reason: 'ignored reviewed argument' }));",
    ].join('\n'));
    const execution = run([
      '--suite', SUITE,
      '--out', out,
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${ADAPTER}`,
      '--adapter-arg', `claude-code=${unrelated}`,
      '--adapter-arg', `claude-code=${ADAPTER}`,
    ]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /safe launch shape|first script argument/i);
    assert.equal(existsSync(out), false);
  } finally {
    removeDir(temp);
  }
});

test('rejects PATH-dependent direct shebang adapter launch', () => {
  const temp = makeTempDir('runtime-smoke-shebang-');
  try {
    const adapter = resolve(temp, 'shebang-adapter');
    const out = resolve(temp, 'result.json');
    writeFileSync(adapter, [
      '#!/usr/bin/env node',
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "process.stdout.write(JSON.stringify({ protocolVersion: 1, runtime: request.runtime, requestId: request.requestId, status: 'skip', reason: 'shebang ran' }));",
    ].join('\n'));
    chmodSync(adapter, 0o755);
    const suitePath = writeSuiteForAdapter(temp, adapter, 'shebang-adapter-v1', 'host', {
      executable: 'entrypoint',
      arguments: [],
      environment: [],
    });
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--adapter', `claude-code=${adapter}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
    ]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /direct shebang|resolved executable/i);
    assert.equal(existsSync(out), false);
  } finally {
    removeDir(temp);
  }
});

test('rejects interpreter control environment before NODE_OPTIONS preload', () => {
  const temp = makeTempDir('runtime-smoke-node-options-');
  try {
    const preload = resolve(temp, 'preload.cjs');
    const marker = resolve(temp, 'preloaded.txt');
    const out = resolve(temp, 'result.json');
    writeFileSync(preload, `if (process.env.RUNTIME_SMOKE_RUNTIME) require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'preloaded');\n`);
    const launch = normalizedNodeLaunch(['NODE_OPTIONS']);
    const suitePath = writeSuiteForAdapter(temp, ADAPTER, 'node-options-v1', 'fixture', launch);
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${ADAPTER}`,
      '--adapter-arg', `claude-code=${ADAPTER}`,
      '--adapter-env', 'claude-code=NODE_OPTIONS',
    ], {
      env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /forbidden adapter environment.*NODE_OPTIONS/i);
    assert.equal(existsSync(marker), false);
  } finally {
    removeDir(temp);
  }
});

test('public fixture adapters exercise the ordered three-runtime matrix', () => {
  const temp = makeTempDir('runtime-smoke-');
  try {
    const out = resolve(temp, 'result.json');
    const execution = run(fixtureArguments(out));
    assert.equal(execution.status, 0, execution.stderr);

    const result = JSON.parse(readFileSync(out, 'utf8'));
    const schema = JSON.parse(readFileSync(RESULT_SCHEMA, 'utf8'));
    assert.deepEqual(validateAgainstSchema(schema, result), []);
    assert.deepEqual(result.runtimes.map(({ runtime, status }) => [runtime, status]), [
      ['claude-code', 'pass'],
      ['github-copilot', 'pass'],
      ['openai-codex', 'pass'],
    ]);
    for (const runtime of result.runtimes) {
      assert.deepEqual(runtime.checks.map(({ check, status }) => [check, status]), [
        ['install', 'pass'],
        ['discovery', 'pass'],
        ['invocation', 'pass'],
        ['resource-resolution', 'pass'],
        ['host-extensions', 'pass'],
      ]);
      assert.equal(runtime.adapter.kind, 'fixture');
      assert.equal(runtime.adapter.sha256, createFileSha256(ADAPTER));
      assert.equal(runtime.adapter.policySha256, normalizedNodeLaunchSha256());
      assert.match(runtime.adapter.launchSha256, /^[0-9a-f]{64}$/);
      assert.notEqual(runtime.adapter.launchSha256, runtime.adapter.policySha256);
    }
    assert.deepEqual(result.summary, { pass: 3, fail: 0, skip: 0 });
    assert.match(execution.stdout, /3 passed, 0 failed, 0 skipped/);
  } finally {
    removeDir(temp);
  }
});

test('unconfigured hosts are explicit skips and never passes', () => {
  const temp = makeTempDir('runtime-smoke-skip-');
  try {
    const out = resolve(temp, 'result.json');
    const execution = run(['--suite', SUITE, '--out', out]);
    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(result.summary.pass, 0);
    assert.equal(result.summary.skip, 3);
    for (const runtime of result.runtimes) {
      assert.equal(runtime.status, 'skip');
      assert.match(runtime.reason, /No adapter command was configured/);
      assert.ok(runtime.checks.every(({ status }) => status === 'skip'));
    }
  } finally {
    removeDir(temp);
  }
});

test('rejects malformed or lying adapter results without writing a report', () => {
  const temp = makeTempDir('runtime-smoke-lie-');
  try {
    const adapter = resolve(temp, 'lying.mjs');
    const out = resolve(temp, 'result.json');
    writeFileSync(adapter, [
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "process.stdout.write(JSON.stringify({ protocolVersion: 1, runtime: 'openai-codex', requestId: request.requestId, status: 'pass' }));",
    ].join('\n'));
    const suitePath = writeSuiteForAdapter(temp, adapter, 'lying-adapter-v1');
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
      '--adapter-arg', `claude-code=${adapter}`,
    ]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /claimed runtime openai-codex; expected claude-code/);
    assert.throws(() => readFileSync(out), /ENOENT/);
  } finally {
    removeDir(temp);
  }
});

test('request contains no expected evidence and an echo-only adapter cannot pass', () => {
  const temp = makeTempDir('runtime-smoke-echo-');
  try {
    const adapter = resolve(temp, 'echo.mjs');
    const capture = resolve(temp, 'request.json');
    const out = resolve(temp, 'result.json');
    writeFileSync(adapter, [
      "import { writeFileSync } from 'node:fs';",
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      `writeFileSync(${JSON.stringify(capture)}, input);`,
      'const request = JSON.parse(input);',
      "process.stdout.write(JSON.stringify({ protocolVersion: 1, runtime: request.runtime, requestId: request.requestId, status: 'pass', discoveredSkill: request.skill?.name, invocation: request.invocation, resourceSha256: request.resource?.sha256, hostExtensionsSha256: request.hostExtensions?.sha256 }));",
    ].join('\n'));
    const suitePath = writeSuiteForAdapter(temp, adapter, 'echo-adapter-v1');
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
      '--adapter-arg', `claude-code=${adapter}`,
    ]);
    assert.equal(execution.status, 1);
    const request = JSON.parse(readFileSync(capture, 'utf8'));
    assert.equal(JSON.stringify(request).includes('sha256'), false);
    assert.equal(JSON.stringify(request).includes('runtime-smoke-resource-v1'), false);
    assert.equal(request.skill?.name, undefined);
    assert.match(execution.stderr, /evidence|unknown property|missing/i);
    assert.equal(existsSync(out), false);
  } finally {
    removeDir(temp);
  }
});

test('reviewed adapter identity remains fixture when its entrypoint is renamed', () => {
  const temp = makeTempDir('runtime-smoke-identity-');
  try {
    const renamed = resolve(temp, 'renamed-host-looking-adapter.mjs');
    const out = resolve(temp, 'result.json');
    copyFileSync(ADAPTER, renamed);
    const execution = run([
      '--suite', SUITE,
      '--out', out,
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${renamed}`,
      '--adapter-arg', `claude-code=${renamed}`,
    ]);
    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(result.runtimes[0].status, 'pass');
    assert.equal(result.runtimes[0].adapter.configured, true);
    assert.equal(result.runtimes[0].adapter.id, 'public-filesystem-v1');
    assert.equal(result.runtimes[0].adapter.kind, 'fixture');
    assert.equal(result.runtimes[0].adapter.sha256, createFileSha256(renamed));
    assert.equal(result.runtimes[0].adapter.policySha256, normalizedNodeLaunchSha256());
    assert.match(result.runtimes[0].adapter.launchSha256, /^[0-9a-f]{64}$/);
  } finally {
    removeDir(temp);
  }
});

test('reviewed host adapters require host-command invocation evidence', () => {
  const temp = makeTempDir('runtime-smoke-host-evidence-');
  try {
    const copiedFixture = resolve(temp, 'claimed-host.mjs');
    const out = resolve(temp, 'result.json');
    copyFileSync(ADAPTER, copiedFixture);
    const suitePath = writeSuiteForAdapter(temp, copiedFixture, 'claimed-host-v1', 'host');
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${copiedFixture}`,
      '--adapter-arg', `claude-code=${copiedFixture}`,
    ]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /host-command invocation evidence/);
    assert.equal(existsSync(out), false);
  } finally {
    removeDir(temp);
  }
});

test('configured unavailable host skips every host-dependent check with one reason', () => {
  const temp = makeTempDir('runtime-smoke-unavailable-');
  try {
    const adapter = resolve(temp, 'unavailable.mjs');
    const out = resolve(temp, 'result.json');
    writeFileSync(adapter, [
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "process.stdout.write(JSON.stringify({ protocolVersion: 1, runtime: request.runtime, requestId: request.requestId, status: 'skip', reason: 'host executable unavailable' }));",
    ].join('\n'));
    const suitePath = writeSuiteForAdapter(temp, adapter, 'unavailable-host-v1');
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
      '--adapter-arg', `claude-code=${adapter}`,
    ]);
    assert.equal(execution.status, 0, execution.stderr);
    const runtime = JSON.parse(readFileSync(out, 'utf8')).runtimes[0];
    assert.equal(runtime.status, 'skip');
    assert.equal(runtime.checks[0].status, 'pass');
    for (const check of runtime.checks.slice(1)) {
      assert.equal(check.status, 'skip');
      assert.equal(check.reason, 'host executable unavailable');
    }
  } finally {
    removeDir(temp);
  }
});

test('fixture source rejects traversal and intermediate symlink escapes before copying', () => {
  const temp = makeTempDir('runtime-smoke-containment-');
  try {
    const suiteRoot = resolve(temp, 'suite');
    const external = resolve(temp, 'external-skill');
    const adapter = resolve(temp, 'must-not-run.mjs');
    const marker = resolve(temp, 'external-bytes-copied.txt');
    mkdirSync(suiteRoot, { recursive: true });
    mkdirSync(external, { recursive: true });
    writeFileSync(resolve(external, 'SKILL.md'), 'outside bytes must not be copied\n');
    writeFileSync(adapter, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'adapter reached copied bytes');\n`);
    const base = JSON.parse(readFileSync(SUITE, 'utf8'));
    base.runtimes[0].adapter = {
      id: 'containment-probe-v1',
      kind: 'host',
      sha256: createFileSha256(adapter),
      launch: normalizedNodeLaunch(),
      launchSha256: normalizedNodeLaunchSha256(),
    };

    for (const [name, skillPath] of [['traversal', '../external-skill'], ['symlink', 'linked/skill']]) {
      if (name === 'symlink') {
        symlinkSync(temp, resolve(suiteRoot, 'linked'));
      }
      const suite = { ...base, skill: { ...base.skill, path: skillPath } };
      const suitePath = resolve(suiteRoot, `${name}.json`);
      const out = resolve(temp, `${name}-result.json`);
      writeFileSync(suitePath, JSON.stringify(suite));
      const execution = run([
        '--suite', suitePath,
        '--out', out,
        '--adapter', `claude-code=${process.execPath}`,
        '--adapter-entrypoint', `claude-code=${adapter}`,
        '--adapter-arg', `claude-code=${adapter}`,
      ]);
      assert.equal(execution.status, 1);
      assert.match(execution.stderr, /escapes managed root|symlink/i);
      assert.equal(existsSync(out), false);
      assert.equal(existsSync(marker), false, 'adapter reached escaped fixture bytes');
    }
  } finally {
    removeDir(temp);
  }
});

test('bounds adapter time and does not pass arbitrary parent secrets', () => {
  const temp = makeTempDir('runtime-smoke-secret-');
  try {
    const adapter = resolve(temp, 'bounded.mjs');
    const out = resolve(temp, 'result.json');
    writeFileSync(adapter, [
      "if (process.env.RUNTIME_SMOKE_TEST_SECRET) { console.error(process.env.RUNTIME_SMOKE_TEST_SECRET); process.exit(9); }",
      "setTimeout(() => process.stdout.write('{}'), 500);",
    ].join('\n'));
    const suitePath = writeSuiteForAdapter(temp, adapter, 'bounded-adapter-v1');
    const command = [
      '--suite', suitePath,
      '--out', out,
      '--timeout-ms', '20',
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
      '--adapter-arg', `claude-code=${adapter}`,
    ];
    const execution = run(command, {
      env: { ...process.env, RUNTIME_SMOKE_TEST_SECRET: 'sentinel-secret' },
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /could not execute|timed out/);
    assert.equal(execution.stderr.includes('sentinel-secret'), false);
  } finally {
    removeDir(temp);
  }
});

test('timeout terminates adapter descendants before they can survive and write', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Runtime smoke process-group supervision supports Darwin and Linux only.');
    return;
  }
  const temp = makeTempDir('runtime-smoke-descendant-');
  try {
    const adapter = resolve(temp, 'parent.mjs');
    const child = resolve(temp, 'child.mjs');
    const controlStarted = resolve(temp, 'control-started.txt');
    const controlMarker = resolve(temp, 'control-survived.txt');
    const childStarted = resolve(temp, 'child-started.txt');
    const parentObserved = resolve(temp, 'parent-observed.txt');
    const processGroup = resolve(temp, 'process-group.txt');
    const marker = resolve(temp, 'survived.txt');
    const out = resolve(temp, 'result.json');
    writeFileSync(child, [
      "import { writeFileSync } from 'node:fs';",
      'const [started, survived] = process.argv.slice(2);',
      "process.on('SIGTERM', () => {});",
      "writeFileSync(started, 'started');",
      "setTimeout(() => writeFileSync(survived, 'survived'), 600);",
      'setTimeout(() => {}, 1000);',
    ].join('\n'));
    const control = spawnSync(process.execPath, [child, controlStarted, controlMarker], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 2000,
    });

    assert.equal(control.status, 0, control.stderr);
    assert.equal(readFileSync(controlStarted, 'utf8'), 'started');
    assert.equal(readFileSync(controlMarker, 'utf8'), 'survived');
    writeFileSync(adapter, [
      "import { spawn } from 'node:child_process';",
      "import { existsSync, writeFileSync } from 'node:fs';",
      "import { setTimeout as delay } from 'node:timers/promises';",
      `writeFileSync(${JSON.stringify(processGroup)}, String(process.pid));`,
      `spawn(process.execPath, [${JSON.stringify(child)}, ${JSON.stringify(childStarted)}, ${JSON.stringify(marker)}], { stdio: 'ignore' });`,
      `while (!existsSync(${JSON.stringify(childStarted)})) await delay(5);`,
      `writeFileSync(${JSON.stringify(parentObserved)}, 'observed');`,
      'setTimeout(() => {}, 1000);',
    ].join('\n'));
    const suitePath = writeSuiteForAdapter(temp, adapter, 'timeout-tree-v1');
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--timeout-ms', '400',
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
      '--adapter-arg', `claude-code=${adapter}`,
    ]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /timed out/i);
    assert.doesNotMatch(execution.stderr, /cleanup failed/i);
    assert.equal(readFileSync(childStarted, 'utf8'), 'started');
    assert.equal(readFileSync(parentObserved, 'utf8'), 'observed');
    const pgid = Number(readFileSync(processGroup, 'utf8'));
    assertProcessGroupGone(pgid);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
    assert.equal(existsSync(marker), false, 'adapter descendant survived timeout');
  } finally {
    removeDir(temp);
  }
});

test('successful adapter output still finalizes surviving descendants', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Runtime smoke process-group supervision supports Darwin and Linux only.');
    return;
  }
  const temp = makeTempDir('runtime-smoke-success-descendant-');
  try {
    const survival = prepareSurvivalProbe(temp, 'success');
    runSurvivalControl(survival);
    const adapter = resolve(temp, 'success-parent.mjs');
    const out = resolve(temp, 'result.json');
    writeFileSync(adapter, successfulParentSource(survival, false));
    const suitePath = writeSuiteForAdapter(temp, adapter, 'success-descendant-v1');
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--timeout-ms', '2000',
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
      '--adapter-arg', `claude-code=${adapter}`,
    ]);
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(readFileSync(survival.started, 'utf8'), 'started');
    assert.equal(readFileSync(survival.observed, 'utf8'), 'observed');
    assertProcessGroupGone(Number(readFileSync(survival.processGroup, 'utf8')));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    assert.equal(existsSync(survival.marker), false, 'success-path descendant survived cleanup');
  } finally {
    removeDir(temp);
  }
});

test('stderr overflow finalizes descendants before returning the limit error', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Runtime smoke process-group supervision supports Darwin and Linux only.');
    return;
  }
  const temp = makeTempDir('runtime-smoke-overflow-descendant-');
  try {
    const survival = prepareSurvivalProbe(temp, 'overflow');
    runSurvivalControl(survival);
    const adapter = resolve(temp, 'overflow-parent.mjs');
    const out = resolve(temp, 'result.json');
    writeFileSync(adapter, successfulParentSource(survival, true));
    const suitePath = writeSuiteForAdapter(temp, adapter, 'overflow-descendant-v1');
    const execution = run([
      '--suite', suitePath,
      '--out', out,
      '--timeout-ms', '2000',
      '--adapter', `claude-code=${process.execPath}`,
      '--adapter-entrypoint', `claude-code=${adapter}`,
      '--adapter-arg', `claude-code=${adapter}`,
    ]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /output limit/i);
    assert.equal(readFileSync(survival.started, 'utf8'), 'started');
    assert.equal(readFileSync(survival.observed, 'utf8'), 'observed');
    assertProcessGroupGone(Number(readFileSync(survival.processGroup, 'utf8')));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    assert.equal(existsSync(survival.marker), false, 'overflow-path descendant survived cleanup');
  } finally {
    removeDir(temp);
  }
});

test('cleanup deadline bounds a direct child that never closes and preserves its workspace', async () => {
  const temp = makeTempDir('runtime-smoke-close-deadline-');
  try {
    const startedAt = performance.now();
    const error = await runWithFakeSupervision(temp, {
      spawn: () => fakeChild({ close: false }),
      processGroupState: () => 'gone',
      terminateProcessGroup: () => {},
    });
    assert.ok(performance.now() - startedAt < 250, 'cleanup exceeded its bounded deadline');
    assert.match(error.message, /cleanup failed.*direct child.*deadline/i);
    assert.match(error.message, /workspace preserved at/i);
    assert.ok(error.preservedWorkspace.startsWith(`${resolve(temp, 'runtime-roots')}/`));
    assert.equal(existsSync(error.preservedWorkspace), true);
    assert.equal(existsSync(resolve(error.preservedWorkspace, 'workspace')), true);
  } finally {
    removeDir(temp);
  }
});

test('persistent process-group polling failure is bounded and preserves its workspace', async () => {
  const temp = makeTempDir('runtime-smoke-poll-deadline-');
  try {
    const startedAt = performance.now();
    const error = await runWithFakeSupervision(temp, {
      spawn: () => fakeChild({ close: true }),
      processGroupState: () => 'permission-denied',
      terminateProcessGroup: () => {},
    });
    assert.ok(performance.now() - startedAt < 250, 'persistent polling exceeded its bounded deadline');
    assert.match(error.message, /cleanup failed.*EPERM/i);
    assert.match(error.message, /workspace preserved at/i);
    assert.ok(error.preservedWorkspace.startsWith(`${resolve(temp, 'runtime-roots')}/`));
    assert.equal(existsSync(error.preservedWorkspace), true);
    assert.equal(existsSync(resolve(error.preservedWorkspace, 'workspace')), true);
  } finally {
    removeDir(temp);
  }
});

test('committed runtime smoke suite is strict and versioned', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/runtime-smoke-suite.schema.json'), 'utf8'));
  const suite = JSON.parse(readFileSync(SUITE, 'utf8'));
  assert.deepEqual(validateAgainstSchema(schema, suite), []);
  assert.match(validateAgainstSchema(schema, { ...suite, unknown: true }).join('\n'), /unknown property/);
  assert.match(validateAgainstSchema(schema, { ...suite, schemaVersion: 2 }).join('\n'), /expected constant 1/);
});

test('suite validation rejects a launch configuration with a stale digest', () => {
  const temp = makeTempDir('runtime-smoke-launch-digest-');
  try {
    const suite = JSON.parse(readFileSync(SUITE, 'utf8'));
    suite.runtimes[0].adapter.launchSha256 = '0'.repeat(64);
    const suitePath = resolve(temp, 'suite.json');
    writeFileSync(suitePath, JSON.stringify(suite));
    mkdirSync(resolve(temp, 'skill'), { recursive: true });
    copyFixtureSkill(resolve(temp, 'skill'));
    const execution = run(['--suite', suitePath, '--out', resolve(temp, 'result.json')]);
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /launch digest/i);
  } finally {
    removeDir(temp);
  }
});

function createFileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function copyFixtureSkill(destination) {
  const source = resolve(REPO_ROOT, 'tests/fixtures/runtime-smoke/skill');
  for (const relativePath of ['SKILL.md', 'references/probe.txt', 'agents/openai.yaml']) {
    const target = resolve(destination, relativePath);
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(resolve(source, relativePath), target);
  }
}

function writeSuiteForAdapter(temp, adapter, id, kind = 'host', launch = normalizedNodeLaunch()) {
  const suite = JSON.parse(readFileSync(SUITE, 'utf8'));
  suite.runtimes[0].adapter = {
    id,
    kind,
    sha256: createFileSha256(adapter),
    launch,
    launchSha256: launchSha256(launch),
  };
  const suitePath = resolve(temp, 'suite.json');
  writeFileSync(suitePath, JSON.stringify(suite));
  mkdirSync(resolve(temp, 'skill'), { recursive: true });
  copyFixtureSkill(resolve(temp, 'skill'));
  return suitePath;
}

function normalizedNodeLaunch(environment = []) {
  return { executable: 'process.execPath', arguments: ['{entrypoint}'], environment };
}

function normalizedNodeLaunchSha256() {
  return launchSha256(normalizedNodeLaunch());
}

function fakeChild({ close }) {
  const child = new EventEmitter();
  child.pid = 424_242;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  if (close) {
    queueMicrotask(() => {
      child.stdout.end('{}');
      child.emit('close', 0, null);
    });
  }
  return child;
}

async function runWithFakeSupervision(temp, supervision) {
  const suite = JSON.parse(readFileSync(SUITE, 'utf8'));
  const adapters = new Map([['claude-code', {
    command: process.execPath,
    entrypoint: ADAPTER,
    args: [ADAPTER],
    environmentNames: [],
  }]]);
  try {
    await runRuntimeSmokeSuite({
      suite,
      suiteDirectory: resolve(REPO_ROOT, 'tests/fixtures/runtime-smoke'),
      adapters,
      timeoutMs: 5,
      tempBase: resolve(temp, 'runtime-roots'),
      processAdapterOptions: {
        supervision,
        terminationGraceMs: 5,
        cleanupTimeoutMs: 30,
      },
    });
  } catch (error) {
    return error;
  }
  assert.fail('expected simulated process cleanup to fail');
}

function launchSha256(launch) {
  return createHash('sha256').update(JSON.stringify(launch)).digest('hex');
}

function assertProcessGroupGone(pgid) {
  try {
    process.kill(-pgid, 0);
    assert.fail(`process group ${pgid} still exists after adapter cleanup`);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    throw error;
  }
}

function prepareSurvivalProbe(temp, prefix) {
    const child = resolve(temp, `${prefix}-child.mjs`);
    const controlStarted = resolve(temp, `${prefix}-control-started.txt`);
    const controlMarker = resolve(temp, `${prefix}-control-marker.txt`);
    const started = resolve(temp, `${prefix}-started.txt`);
    const observed = resolve(temp, `${prefix}-observed.txt`);
    const marker = resolve(temp, `${prefix}-survived.txt`);
    const processGroup = resolve(temp, `${prefix}-process-group.txt`);
    writeFileSync(child, [
      "import { writeFileSync } from 'node:fs';",
      'const [startedPath, markerPath] = process.argv.slice(2);',
      "process.on('SIGTERM', () => {});",
      "writeFileSync(startedPath, 'started');",
      "setTimeout(() => writeFileSync(markerPath, 'survived'), 300);",
      'setTimeout(() => {}, 600);',
    ].join('\n'));
    return { child, controlStarted, controlMarker, started, observed, marker, processGroup };
}

function runSurvivalControl(survival) {
    const control = spawnSync(process.execPath, [
      survival.child,
      survival.controlStarted,
      survival.controlMarker,
    ], { encoding: 'utf8', timeout: 2000 });
    assert.equal(control.status, 0, control.stderr);
    assert.equal(readFileSync(survival.controlStarted, 'utf8'), 'started');
    assert.equal(readFileSync(survival.controlMarker, 'utf8'), 'survived');
}

function successfulParentSource(survival, overflow) {
    return [
      "import { spawn } from 'node:child_process';",
      "import { existsSync, writeFileSync } from 'node:fs';",
      "import { setTimeout as delay } from 'node:timers/promises';",
      `writeFileSync(${JSON.stringify(survival.processGroup)}, String(process.pid));`,
      `const descendant = spawn(process.execPath, [${JSON.stringify(survival.child)}, ${JSON.stringify(survival.started)}, ${JSON.stringify(survival.marker)}], { stdio: 'ignore' });`,
      'descendant.unref();',
      `while (!existsSync(${JSON.stringify(survival.started)})) await delay(5);`,
      `writeFileSync(${JSON.stringify(survival.observed)}, 'observed');`,
      overflow ? "process.stderr.write('x'.repeat(2 * 1024 * 1024 + 1));" : '',
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "process.stdout.write(JSON.stringify({ protocolVersion: 1, runtime: request.runtime, requestId: request.requestId, status: 'skip', reason: 'host unavailable after child start' }));",
    ].filter(Boolean).join('\n');
}
