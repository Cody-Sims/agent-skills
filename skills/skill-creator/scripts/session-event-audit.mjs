#!/usr/bin/env node
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve, parse, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 16, maxBytes: 64 * 1024 * 1024, maxLineBytes: 256 * 1024,
  maxLines: 250000, maxEvents: 100000, maxIdentities: 20000, maxOutputBytes: 8192,
});
const CEILINGS = {
  maxFiles: 256, maxBytes: 1024 * 1024 * 1024, maxLineBytes: 4 * 1024 * 1024,
  maxLines: 1000000, maxEvents: 1000000, maxIdentities: 100000, maxOutputBytes: 65536,
};
const invalid = () => new Error('Invalid audit options');
const decoder = new TextDecoder('utf-8', { fatal: true });

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 29) return null;
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match) return null;
  const zone = match[4];
  if (zone !== 'Z' && (Number(zone.slice(4)) > 59 || zone === '-00:00')) return null;
  const local = `${match[1]}T${match[2]}${(match[3] ?? '.000').padEnd(4, '0')}Z`;
  const localMs = Date.parse(local);
  if (!Number.isFinite(localMs) || new Date(localMs).toISOString() !== local) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

async function openRegularFile(input) {
  const absolute = resolve(input);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Unavailable input');
  }
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unavailable input');
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function optionsFor(options) {
  if (!options || typeof options !== 'object') throw invalid();
  const { files, start, end, metadataWatermark, limits: overrides = {} } = options;
  const from = timestamp(start);
  const until = timestamp(end);
  const metadata = metadataWatermark === undefined ? null : timestamp(metadataWatermark);
  if (!Array.isArray(files) || files.length === 0 || from === null || until === null ||
      from >= until || (metadataWatermark !== undefined && metadata === null) ||
      !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw invalid();
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(CEILINGS, key) || !Number.isSafeInteger(value) || value < 1 ||
        value > CEILINGS[key] || (key === 'maxOutputBytes' && value < 256)) throw invalid();
    limits[key] = value;
  }
  // Inspect only the bounded prefix; excess inputs are reported rather than visited.
  const selected = files.slice(0, limits.maxFiles);
  if (selected.some(file => typeof file !== 'string' || !file.length ||
      file.length > 4096 || file.includes('\0'))) throw invalid();
  return { files, selected, from, until, metadata, limits };
}

/** Audit only caller-authorized files. Never discover history or return raw evidence. */
export async function auditSessionEvents(options) {
  const { files, selected, from, until, metadata, limits } = optionsFor(options);
  const report = {
    schemaVersion: 1,
    interval: { start: new Date(from).toISOString(), end: new Date(until).toISOString(), convention: '[start,end)' },
    limits,
    coverage: {
      suppliedFilesOnly: true, scanComplete: true, filesAttempted: 0, filesRead: 0,
      bytesRead: 0, lines: 0, events: 0, outsideWindow: 0, fileScopedIdentities: 0,
    },
    conditions: {
      parseErrors: 0, invalidTimestamps: 0, invalidEvents: 0, unavailableFiles: 0,
      readErrors: 0, unterminatedLines: 0, changedFiles: 0, conflictingEvents: 0, limitHits: [],
    },
    calls: { completed: 0, paired: 0, pending: 0, completionWithoutStart: 0, duplicateEvents: 0, unclassified: 0 },
    transport: { success: 0, failure: 0, unknown: 0 },
    shell: { zero: 0, nonzero: 0, missing: 0 },
    attribution: { coordinator: 0, worker: 0, unknown: 0 },
    completionErrors: 0,
    watermarks: {
      raw: null, metadata: metadata === null ? null : new Date(metadata).toISOString(),
      metadataAheadOfRaw: null, rawAheadOfMetadata: null, gapMilliseconds: null,
    },
  };
  const { coverage, conditions } = report;
  const hit = name => {
    if (!conditions.limitHits.includes(name)) conditions.limitHits.push(name);
    coverage.scanComplete = false;
  };
  if (files.length > limits.maxFiles) hit('maxFiles');
  const calls = new Map();
  let rawWatermark = null;
  let stop = false;
  function record(line, context) {
    let event;
    try { event = JSON.parse(decoder.decode(line)); }
    catch { conditions.parseErrors++; return; }
    if (coverage.events === limits.maxEvents) { hit('maxEvents'); stop = true; return; }
    coverage.events++;
    const time = timestamp(event?.timestamp);
    if (time === null) { conditions.invalidTimestamps++; return; }
    rawWatermark = rawWatermark === null ? time : Math.max(rawWatermark, time);
    if (time < from || time >= until) { coverage.outsideWindow++; return; }
    const kind = event?.type === 'tool.execution_start' ? 'start' :
      event?.type === 'tool.execution_complete' ? 'complete' : null;
    if (!kind) return;
    const data = event.data;
    const id = data?.toolCallId;
    const owner = data?.ownerNativeSessionId;
    const parent = data?.parentToolCallId;
    const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
    if (!validId(id) || (owner !== undefined && owner !== null && !validId(owner)) ||
        (parent !== undefined && parent !== null && !validId(parent))) {
      conditions.invalidEvents++;
      return;
    }
    const fileScoped = !validId(owner);
    const key = createHash('sha256').update(JSON.stringify([
      fileScoped ? ['file', context] : ['owner', owner], parent ?? null, id,
    ])).digest('hex');
    let call = calls.get(key);
    if (!call) {
      if (calls.size === limits.maxIdentities) { hit('maxIdentities'); stop = true; return; }
      call = { role: validId(parent) ? 'worker' : fileScoped ? 'unknown' : 'coordinator' };
      calls.set(key, call);
      if (fileScoped) coverage.fileScopedIdentities++;
    }
    const exit = data.shellExecution?.exitCode ?? data.result?.shellExecution?.exitCode ?? data.result?.exitCode;
    const normalized = kind === 'start' ? { time } : {
      time, transport: data.success === true ? 'success' : data.success === false ? 'failure' : 'unknown',
      shell: Number.isSafeInteger(exit) ? exit === 0 ? 'zero' : 'nonzero' : 'missing',
      error: data.error !== undefined && data.error !== null,
    };
    if (call[kind]) {
      if (JSON.stringify(call[kind]) === JSON.stringify(normalized)) report.calls.duplicateEvents++;
      else if (!call.conflict) { call.conflict = true; conditions.conflictingEvents++; }
    } else call[kind] = normalized;
  }

  const line = Buffer.alloc(limits.maxLineBytes);
  const chunk = Buffer.alloc(Math.min(16384, limits.maxBytes));
  for (const file of selected) {
    if (stop) break;
    coverage.filesAttempted++;
    let opened;
    try { opened = await openRegularFile(file); }
    catch { conditions.unavailableFiles++; continue; }
    const { handle, stat } = opened;
    let position = 0;
    let length = 0;
    let oversized = false;
    let changed = false;
    const size = Number(stat.size);
    try {
      while (position < size && !stop) {
        if (coverage.bytesRead === limits.maxBytes) { hit('maxBytes'); stop = true; break; }
        const amount = Math.min(chunk.length, size - position, limits.maxBytes - coverage.bytesRead);
        const { bytesRead } = await handle.read(chunk, 0, amount, position);
        if (bytesRead === 0) { changed = true; break; }
        position += bytesRead;
        coverage.bytesRead += bytesRead;
        for (let index = 0; index < bytesRead && !stop; index++) {
          const byte = chunk[index];
          if (coverage.lines === limits.maxLines) { hit('maxLines'); stop = true; break; }
          if (byte === 10) {
            coverage.lines++;
            if (!oversized) record(line.subarray(0, length), `${stat.dev}:${stat.ino}`);
            length = 0;
            oversized = false;
          } else if (!oversized) {
            if (length === limits.maxLineBytes) { hit('maxLineBytes'); oversized = true; }
            else line[length++] = byte;
          }
        }
      }
      if (!stop && (length || oversized)) conditions.unterminatedLines++;
      const after = await handle.stat({ bigint: true });
      if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs) changed = true;
      if (!stop && position === size) coverage.filesRead++;
    } catch { conditions.readErrors++; }
    finally {
      if (changed) conditions.changedFiles++;
      try { await handle.close(); }
      catch { conditions.readErrors++; }
    }
  }

  for (const call of calls.values()) {
    report.attribution[call.role]++;
    if (!call.complete) { report.calls.pending++; continue; }
    report.calls.completed++;
    report.calls.unclassified++;
    report.calls[call.start ? 'paired' : 'completionWithoutStart']++;
    report.transport[call.conflict ? 'unknown' : call.complete.transport]++;
    report.shell[call.conflict ? 'missing' : call.complete.shell]++;
    if (call.complete.error) report.completionErrors++;
  }
  if (rawWatermark !== null) report.watermarks.raw = new Date(rawWatermark).toISOString();
  if (metadata !== null && rawWatermark !== null) {
    report.watermarks.metadataAheadOfRaw = metadata > rawWatermark;
    report.watermarks.rawAheadOfMetadata = rawWatermark > metadata;
    report.watermarks.gapMilliseconds = Math.abs(metadata - rawWatermark);
  }
  if (Object.entries(conditions).some(([key, value]) => key !== 'limitHits' && value > 0)) coverage.scanComplete = false;
  if (Buffer.byteLength(JSON.stringify(report) + '\n') > limits.maxOutputBytes) {
    return {
      schemaVersion: 1, coverage: { scanComplete: false, suppliedFilesOnly: true },
      conditions: { limitHits: ['maxOutputBytes'] }, detailsOmitted: true,
    };
  }
  return report;
}

const HELP = 'Usage: node session-event-audit.mjs --start OFFSET_TIMESTAMP --end OFFSET_TIMESTAMP --input FILE [--input FILE ...] [--metadata-watermark OFFSET_TIMESTAMP] [--max-files N --max-bytes N --max-line-bytes N --max-lines N --max-events N --max-identities N --max-output-bytes N]\n';
async function cli(args) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return; }
  try {
    const options = { files: [], limits: {} };
    const limitFlags = Object.fromEntries(Object.keys(DEFAULT_LIMITS).map(key => [
      `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, key,
    ]));
    const seen = new Set();
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index];
      const value = args[index + 1];
      if (!value || (seen.has(flag) && flag !== '--input')) throw invalid();
      seen.add(flag);
      if (flag === '--input') options.files.push(value);
      else if (flag === '--start' || flag === '--end') options[flag.slice(2)] = value;
      else if (flag === '--metadata-watermark') options.metadataWatermark = value;
      else if (Object.hasOwn(limitFlags, flag) && /^\d+$/.test(value)) options.limits[limitFlags[flag]] = Number(value);
      else throw invalid();
    }
    const report = await auditSessionEvents(options);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (!report.coverage.scanComplete) process.exitCode = 2;
  } catch {
    process.stderr.write('Audit failed: invalid options or internal read failure. Use --help.\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await cli(process.argv.slice(2));
}
