import { spawnSync } from 'node:child_process';

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

function allowedEnvironment(names, additions) {
  const environment = { ...additions };
  for (const name of [...DEFAULT_ENVIRONMENT, ...names]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid adapter environment variable name: ${name}.`);
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
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
  const execution = spawnSync(command, args, {
    cwd,
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: allowedEnvironment(environmentNames, environment),
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