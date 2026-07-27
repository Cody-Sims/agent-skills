import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { sha256 } from './paths.mjs';
import { assertSafeAdapterEnvironment } from './process-adapter.mjs';

const DEFAULT_MAX_ARGS = 8;
const MAX_ARG_LENGTH = 4096;

export function normalizeSafeAdapterLaunch({
  command,
  entrypoint,
  args,
  environmentNames,
  maxArgs = DEFAULT_MAX_ARGS,
}) {
  const resolvedEntrypoint = resolve(entrypoint);
  if (!isAbsolute(command)) {
    throw new Error('Adapter safe launch shape requires an absolute executable and rejects PATH resolution.');
  }
  if (!Array.isArray(args) || args.length > maxArgs) {
    throw new Error(`Adapter safe launch shape permits at most ${maxArgs} reviewed arguments.`);
  }
  if (args.some((argument) => typeof argument !== 'string' || argument.length > MAX_ARG_LENGTH)) {
    throw new Error(`Adapter safe launch arguments must be strings no longer than ${MAX_ARG_LENGTH} characters.`);
  }
  const environment = [...environmentNames];
  if (new Set(environment).size !== environment.length) {
    throw new Error('Configured adapter environment allowlist contains duplicates.');
  }
  assertSafeAdapterEnvironment(environment);
  environment.sort();

  if (command === process.execPath) {
    if (args.length === 0 || resolve(args[0]) !== resolvedEntrypoint) {
      throw new Error('Node adapter safe launch shape requires the reviewed entrypoint as the actual first script argument.');
    }
  } else if (command === resolvedEntrypoint) {
    if (args.length !== 0) {
      throw new Error('Direct adapter safe launch shape requires zero arguments.');
    }
    if (readFileSync(resolvedEntrypoint).subarray(0, 2).toString('utf8') === '#!') {
      throw new Error('Adapter safe launch shape rejects direct shebang entrypoints.');
    }
  } else {
    throw new Error('Adapter safe launch shape requires process.execPath or the reviewed executable itself.');
  }

  return {
    command,
    entrypoint: resolvedEntrypoint,
    args: [...args],
    environmentNames: environment,
    maxArgs,
  };
}

export function portableAdapterLaunchPolicy(normalized) {
  return {
    executable: normalized.command === process.execPath ? 'process.execPath' : 'entrypoint',
    arguments: normalized.command === process.execPath
      ? ['{entrypoint}', ...normalized.args.slice(1)]
      : [],
    environment: [...normalized.environmentNames],
    maxArgs: normalized.maxArgs,
  };
}

export function adapterLaunchDigests(normalized) {
  const launch = {
    command: normalized.command,
    entrypoint: normalized.entrypoint,
    arguments: [...normalized.args],
    environment: [...normalized.environmentNames],
  };
  return {
    launchSha256: sha256(JSON.stringify(launch)),
    policySha256: sha256(JSON.stringify({
      protocolVersion: 1,
      launch,
      maxArgs: normalized.maxArgs,
    })),
  };
}
