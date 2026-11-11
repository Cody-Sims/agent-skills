import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const modulePath = resolve('skills/skill-creator/scripts/session-event-audit.mjs');
const start = '2026-11-10T00:00:00Z';
const end = '2026-11-11T00:00:00Z';
let sequence = 0;
const event = (type, toolCallId, data = {}, timestamp = start) => ({
  type: `tool.execution_${type}`, timestamp,
  data: { toolCallId, toolName: 'bash', ownerNativeSessionId: 'owner-private', ...data },
});
async function fixture(t, contents) {
  const directory = resolve(`tests/fixtures/session-event-audit/run-${process.pid}-${sequence++}`);
  await mkdir(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = [];
  for (const [index, content] of contents.entries()) {
    const file = `${directory}/${index}.jsonl`;
    await writeFile(file, Array.isArray(content) ? content.map(JSON.stringify).join('\n') + '\n' : content);
    files.push(file);
  }
  return files;
}
async function audit(options) {
  // A missing implementation yields the intended behavioral assertion, not an import error.
  const module = await import(pathToFileURL(modulePath)).catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
  });
  assert.equal(typeof module.auditSessionEvents, 'function', 'bounded raw-event audit API is required');
  return module.auditSessionEvents({ start, end, ...options });
}

test('half-open offset-aware window and separate shell/transport outcomes', async t => {
  const files = await fixture(t, [[
    event('start', 'one'),
    event('complete', 'one', { success: true, shellExecution: { exitCode: 2 } }, '2026-11-09T16:00:00-08:00'),
    event('complete', 'two', { success: false, error: 'private error' }, '2026-11-10T23:59:59.999Z'),
    event('complete', 'excluded', { success: true }, end),
    event('complete', 'before', { success: true }, '2026-11-09T23:59:59.999Z'),
  ]]);
  const result = await audit({ files });
  assert.equal(result.calls.completed, 2);
  assert.equal(result.calls.paired, 1);
  assert.equal(result.calls.completionWithoutStart, 1);
  assert.deepEqual(result.transport, { success: 1, failure: 1, unknown: 0 });
  assert.deepEqual(result.shell, { zero: 0, nonzero: 1, missing: 1 });
  assert.equal(result.calls.unclassified, 2);
  assert.equal(result.coverage.outsideWindow, 2);
  const equivalent = await audit({
    files, start: '2026-11-10T23:00:00+23:00', end: '2026-11-11T23:00:00+23:00',
  });
  assert.equal(equivalent.calls.completed, 2);
});

test('deduplicates parent/fork copies without conflating execution contexts', async t => {
  const worker = [
    event('start', 'shared', { parentToolCallId: 'parent-private' }),
    event('complete', 'shared', { parentToolCallId: 'parent-private', success: true, shellExecution: { exitCode: 0 } }),
  ];
  const files = await fixture(t, [
    [...worker, event('start', 'pending')],
    [...worker, event('complete', 'shared', { ownerNativeSessionId: 'other-owner', success: true })],
    [event('complete', 'shared', { ownerNativeSessionId: undefined, success: true })],
    [event('complete', 'shared', { ownerNativeSessionId: undefined, success: true })],
  ]);
  const result = await audit({ files });
  assert.equal(result.calls.completed, 4);
  assert.equal(result.calls.pending, 1);
  assert.equal(result.calls.duplicateEvents, 2);
  assert.deepEqual(result.attribution, { coordinator: 2, worker: 1, unknown: 2 });
  assert.equal(result.coverage.fileScopedIdentities, 2);
});

test('reports malformed records, invalid timestamps, unavailable files and live tails', async t => {
  const files = await fixture(t, [
    `not json\n${JSON.stringify(event('complete', 'bad-date', {}, '2026-02-30T00:00:00Z'))}\n{"type":`,
    `${JSON.stringify(event('complete', 'valid-but-live', { success: true }))}`,
  ]);
  const result = await audit({ files: [...files, `${files[0]}.missing`] });
  assert.equal(result.conditions.parseErrors, 1);
  assert.equal(result.conditions.invalidTimestamps, 1);
  assert.equal(result.conditions.unterminatedLines, 2);
  assert.equal(result.conditions.unavailableFiles, 1);
  assert.equal(result.calls.completed, 0);
  assert.equal(result.coverage.scanComplete, false);
});

test('finite file, byte, line, event, line-size and output budgets disclose truncation', async t => {
  const files = await fixture(t, [[event('start', 'a'), event('complete', 'a', { success: true })], 'x'.repeat(8192) + '\n']);
  for (const limits of [
    { maxFiles: 1 }, { maxBytes: 20 }, { maxLines: 1 }, { maxEvents: 1 },
    { maxLineBytes: 32 }, { maxOutputBytes: 256 },
  ]) {
    const result = await audit({ files, limits });
    assert.equal(result.coverage.scanComplete, false, JSON.stringify(limits));
    assert.ok(result.conditions.limitHits.length > 0);
    if (limits.maxOutputBytes) assert.ok(Buffer.byteLength(JSON.stringify(result) + '\n') <= 256);
  }
});

test('metadata watermark gaps use supplied timestamps only; output never exposes evidence', async t => {
  const files = await fixture(t, [[event('complete', 'secret-call', {
    success: true, arguments: { command: 'secret-command' },
    result: { stdout: 'secret-stdout', detailedResultPath: '/private/secret-reference' },
  })]]);
  const result = await audit({ files, metadataWatermark: '2026-11-10T01:00:00Z' });
  assert.equal(result.watermarks.metadataAheadOfRaw, true);
  const output = JSON.stringify(result);
  for (const secret of ['secret', 'owner-private', files[0], 'bash', 'arguments', 'stdout']) {
    assert.ok(!output.includes(secret), secret);
  }
  const withoutMetadata = await audit({ files });
  assert.equal(withoutMetadata.watermarks.metadataAheadOfRaw, null);
  const staleMetadata = await audit({ files, metadataWatermark: '2026-11-09T20:00:00Z' });
  assert.equal(staleMetadata.watermarks.rawAheadOfMetadata, true);
  assert.equal(staleMetadata.watermarks.gapMilliseconds, 14400000);
});

test('rejects symlinks, invalid bounds and unsafe budgets without leaking paths', async t => {
  const files = await fixture(t, [[]]);
  const link = `${files[0]}.link`;
  await symlink(files[0], link);
  const result = await audit({ files: [link] });
  assert.equal(result.conditions.unavailableFiles, 1);
  for (const options of [
    { start: '2026-11-10' }, { start: '2026-11-10T00:00:00+24:00' }, { end: start },
    { limits: { maxBytes: Number.MAX_SAFE_INTEGER + 1 } },
    { files: [] }, { limits: { unknown: 1 } },
  ]) await assert.rejects(() => audit({ files, ...options }), /Invalid audit options/);
});

test('CLI emits only bounded aggregates and uses distinct incomplete/invalid exits', async t => {
  const files = await fixture(t, [[event('complete', 'cli-private', { success: true })]]);
  const run = (...args) => spawnSync(process.execPath, [modulePath, ...args], { encoding: 'utf8' });
  const result = run('--start', start, '--end', end, '--input', files[0]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).calls.completed, 1);
  assert.equal(result.stderr, '');
  const missing = run('--start', start, '--end', end, '--input', `${files[0]}.missing`);
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).conditions.unavailableFiles, 1);
  const invalid = run('--input', files[0]);
  assert.equal(invalid.status, 1);
  assert.ok(!invalid.stderr.includes(files[0]));
});

test('oversized irrelevant snapshots do not prevent bounded subsequent event inspection', async t => {
  const files = await fixture(t, [
    'x'.repeat(10000) + '\n' + JSON.stringify(event('complete', 'after-large', {
      success: true, result: { shellExecution: { exitCode: 3 } },
    })) + '\n',
  ]);
  const result = await audit({ files, limits: { maxLineBytes: 512, maxBytes: 512 * 1024 * 1024 } });
  assert.equal(result.calls.completed, 1);
  assert.equal(result.shell.nonzero, 1);
  assert.deepEqual(result.conditions.limitHits, ['maxLineBytes']);
  assert.equal(result.coverage.scanComplete, false);
});

test('identity caps, conflicting copies and window-local pairing remain explicit', async t => {
  const files = await fixture(t, [[
    event('start', 'outside-start', {}, '2026-11-09T23:59:59Z'),
    event('complete', 'outside-start', { success: true }),
    event('complete', 'conflict', { success: true, shellExecution: { exitCode: 0 } }),
    event('complete', 'conflict', { success: false, shellExecution: { exitCode: 1 } }),
  ]]);
  const result = await audit({ files });
  assert.equal(result.calls.completionWithoutStart, 2);
  assert.equal(result.conditions.conflictingEvents, 1);
  assert.equal(result.transport.unknown, 1);
  assert.equal(result.shell.missing, 2);
  const capped = await audit({ files, limits: { maxIdentities: 1 } });
  assert.deepEqual(capped.conditions.limitHits, ['maxIdentities']);
  assert.equal(capped.calls.completed, 1);
  assert.equal(capped.coverage.scanComplete, false);
});
