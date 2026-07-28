import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_ENVIRONMENT = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'COMSPEC',
  'PATHEXT',
];

const FORBIDDEN_ENVIRONMENT = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'RUBYLIB',
  'PERL5OPT',
  'PERL5LIB',
  'BASH_ENV',
  'ENV',
  'SHELLOPTS',
  'IFS',
]);

function isForbiddenEnvironment(name) {
  return FORBIDDEN_ENVIRONMENT.has(name)
    || name.startsWith('LD_')
    || name.startsWith('DYLD_');
}

export function assertSafeAdapterEnvironment(names) {
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid adapter environment variable name: ${name}.`);
    if (isForbiddenEnvironment(name)) throw new Error(`Forbidden adapter environment variable: ${name}.`);
  }
}

export function buildAdapterEnvironment(names, additions) {
  const environment = {};
  assertSafeAdapterEnvironment([...names, ...Object.keys(additions)]);
  for (const name of [...DEFAULT_ENVIRONMENT, ...names]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, ...additions };
}

export function runJsonAdapter({
  command,
  args,
  cwd,
  request,
  timeoutMs,
  environmentNames = [],
  environment = {},
  label,
}) {
  const startedAt = performance.now();
  const isolatedEnvironment = {
    HOME: cwd,
    XDG_CONFIG_HOME: resolve(cwd, '.config'),
    XDG_CACHE_HOME: resolve(cwd, '.cache'),
    TMPDIR: cwd,
    TEMP: cwd,
    TMP: cwd,
    ...environment,
  };
  const execution = spawnSync(command, args, {
    cwd,
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: buildAdapterEnvironment(environmentNames, isolatedEnvironment),
    shell: false,
  });
  if (execution.error) {
    throw new Error(`${label} could not execute (${execution.error.code ?? 'unknown error'}); stderr suppressed.`);
  }
  if (execution.status !== 0) {
    throw new Error(`${label} failed with exit code ${execution.status}; stderr suppressed.`);
  }
  let response;
  try {
    response = JSON.parse(execution.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON; stdout suppressed.`);
  }
  return { response, durationMs: performance.now() - startedAt };
}

function terminateProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function processGroupState(pgid) {
  try {
    process.kill(-pgid, 0);
    return 'exists';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'gone';
    if (error?.code === 'EPERM') return 'permission-denied';
    throw error;
  }
}

function remainingUntil(deadline) {
  return Math.max(0, deadline - performance.now());
}

function beforeDeadline(promise, deadline, timeoutMessage) {
  const remaining = remainingUntil(deadline);
  if (remaining === 0) return Promise.reject(new Error(timeoutMessage));
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), remaining);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        if (remainingUntil(deadline) === 0) reject(new Error(timeoutMessage));
        else resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForProcessGroupExit(pgid, deadline, state) {
  while (true) {
    const remaining = remainingUntil(deadline);
    if (remaining === 0) {
      const current = state(pgid);
      if (current === 'permission-denied') {
        throw new Error(`Process group ${pgid} cleanup remained unverifiable (persistent EPERM) at the cleanup deadline.`);
      }

      throw new Error(`Process group ${pgid} remained at the cleanup deadline.`);
    }
    const current = state(pgid);
    if (current === 'gone') return;
    await delay(Math.min(10, remaining));
  }
}

async function cleanupProcessGroup(child, closed, terminationGraceMs, cleanupTimeoutMs, supervision) {
  const deadline = performance.now() + cleanupTimeoutMs;
  if (!child.pid) {
    await beforeDeadline(closed, deadline, 'Direct child did not close before the cleanup deadline.');
    return;
  }
  if (supervision.processGroupState(child.pid) !== 'gone') {
    supervision.terminateProcessGroup(child, 'SIGTERM');
    const grace = Math.min(terminationGraceMs, remainingUntil(deadline));
    if (grace > 0) await delay(grace);
    if (remainingUntil(deadline) === 0) {
      throw new Error(`Process group ${child.pid} termination exceeded the cleanup deadline.`);
    }
    if (supervision.processGroupState(child.pid) !== 'gone') {
      supervision.terminateProcessGroup(child, 'SIGKILL');
    }
  }
  await Promise.all([
    beforeDeadline(closed, deadline, 'Direct child did not close before the cleanup deadline.'),
    waitForProcessGroupExit(child.pid, deadline, supervision.processGroupState),
  ]);
}

function cleanupFailure(label, error) {
  const failure = new Error(`${label} process cleanup failed (${error.message}); stdout and stderr suppressed.`);
  failure.cleanupUncertain = true;
  return failure;
}

export function runJsonAdapterAsync({
  command,
  args,
  cwd,
  request,
  timeoutMs,
  environmentNames = [],
  environment = {},
  label,
  terminationGraceMs = 100,
  cleanupTimeoutMs = 1_000,
  supervision: supervisionOverrides = {},
}) {
  if (process.platform === 'win32' && !supervisionOverrides.spawn) {
    return Promise.reject(new Error(`${label} is unsupported on Windows because process-group termination is unavailable.`));
  }
  const supervision = {
    spawn: supervisionOverrides.spawn ?? spawn,
    processGroupState: supervisionOverrides.processGroupState ?? processGroupState,
    terminateProcessGroup: supervisionOverrides.terminateProcessGroup ?? terminateProcessGroup,
  };
  const isolatedEnvironment = {
    HOME: cwd,
    XDG_CONFIG_HOME: resolve(cwd, '.config'),
    XDG_CACHE_HOME: resolve(cwd, '.cache'),
    TMPDIR: cwd,
    TEMP: cwd,
    TMP: cwd,
    ...environment,
  };
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now();
    const child = supervision.spawn(command, args, {
      cwd,
      env: buildAdapterEnvironment(environmentNames, isolatedEnvironment),
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let executionError = null;
    let settled = false;
    let finalizing = false;
    let resolveClosed;
    const closed = new Promise((resolvePromise) => {
      resolveClosed = resolvePromise;
    });

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.stdin.removeAllListeners();
      child.removeAllListeners();
      if (error) reject(error);
      else resolvePromise(value);
    };

    const finalize = (error, value) => {
      if (finalizing || settled) return;
      finalizing = true;
      clearTimeout(timeoutTimer);
      void cleanupProcessGroup(child, closed, terminationGraceMs, cleanupTimeoutMs, supervision)
        .then(() => finish(error, value))
        .catch((cleanupError) => {
          finish(cleanupFailure(label, cleanupError));
        });
    };

    const timeoutTimer = setTimeout(() => {
      finalize(new Error(`${label} timed out after ${timeoutMs}ms; process group terminated and stderr suppressed.`));
    }, timeoutMs);

    child.on('error', (error) => {
      executionError = error;
    });
    child.stdout.on('data', (chunk) => {
      if (finalizing) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > 2 * 1024 * 1024) {
        finalize(new Error(`${label} exceeded the 2097152-byte output limit; stdout and stderr suppressed.`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (finalizing) return;
      stderrBytes += chunk.length;
      if (stderrBytes > 2 * 1024 * 1024) {
        finalize(new Error(`${label} exceeded the 2097152-byte output limit; stdout and stderr suppressed.`));
      }
    });
    child.on('close', (status, signal) => {
      resolveClosed();
      if (finalizing) return;
      if (executionError) {
        finalize(new Error(`${label} could not execute (${executionError.code ?? 'unknown error'}); stderr suppressed.`));
        return;
      }
      if (status !== 0) {
        finalize(new Error(`${label} failed with exit code ${status ?? `signal ${signal}`}; stderr suppressed.`));
        return;
      }
      let response;
      try {
        response = JSON.parse(Buffer.concat(stdout).toString('utf8'));
      } catch {
        finalize(new Error(`${label} returned invalid JSON; stdout suppressed.`));
        return;
      }
      finalize(null, { response, durationMs: performance.now() - startedAt });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}