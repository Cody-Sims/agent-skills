import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parseFrontmatter } from './frontmatter.mjs';
import {
  assertNoSymlinks,
  pathEntryExists,
  sha256,
  sha256File,
  walkFiles,
} from './paths.mjs';
import {
  assertSafeAdapterEnvironment,
  buildAdapterEnvironment,
  runJsonAdapterAsync,
} from './process-adapter.mjs';

export const RUNTIMES = ['claude-code', 'github-copilot', 'openai-codex'];
export const CHECKS = ['install', 'discovery', 'invocation', 'resource-resolution', 'host-extensions'];

function pass(check) {
  return { check, status: 'pass', reason: null };
}

function skippedChecks(reason) {
  return CHECKS.map((check) => ({ check, status: 'skip', reason }));
}

function extensionEvidence(skillRoot, extensions) {
  const { data } = parseFrontmatter(readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8'));
  const evidence = [];
  for (const extension of extensions) {
    if (extension.includes('/')) {
      const path = assertNoSymlinks(skillRoot, extension);
      if (!existsSync(path)) throw new Error(`Host extension is missing: ${extension}.`);
      evidence.push({ name: extension, value: readFileSync(path, 'utf8') });
    } else {
      if (!(extension in data)) throw new Error(`Host extension frontmatter is missing: ${extension}.`);
      evidence.push({ name: extension, value: data[extension] });
    }
  }
  return evidence;
}

function validateAdapterResponse(response, expected) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error(`${expected.runtime} adapter returned a non-object result.`);
  }
  const allowed = new Set([
    'protocolVersion', 'runtime', 'requestId', 'status', 'reason', 'discoveredSkill',
    'invocationEvidence', 'resourceContent', 'hostExtensions',
  ]);
  for (const key of Object.keys(response)) {
    if (!allowed.has(key)) throw new Error(`${expected.runtime} adapter returned unknown property ${key}.`);
  }
  if (response.protocolVersion !== 1) throw new Error(`${expected.runtime} adapter protocolVersion must be 1.`);
  if (response.runtime !== expected.runtime) {
    throw new Error(`${expected.runtime} adapter claimed runtime ${response.runtime}; expected ${expected.runtime}.`);
  }
  if (response.requestId !== expected.requestId) throw new Error(`${expected.runtime} adapter returned the wrong requestId.`);
  if (!['pass', 'fail', 'skip'].includes(response.status)) {
    throw new Error(`${expected.runtime} adapter returned an invalid status.`);
  }
  if (response.status !== 'pass') {
    if (typeof response.reason !== 'string' || response.reason.length === 0) {
      throw new Error(`${expected.runtime} adapter ${response.status} result requires a reason.`);
    }
    return;
  }
  if (response.discoveredSkill !== expected.skillName) {
    throw new Error(`${expected.runtime} adapter returned false discoveredSkill evidence.`);
  }
  if (!response.invocationEvidence
      || Object.keys(response.invocationEvidence).sort().join(',') !== 'command,exitCode,hostVersion,kind,output'
      || response.invocationEvidence.command !== expected.invocation
      || response.invocationEvidence.exitCode !== 0
      || response.invocationEvidence.output !== expected.resourceContent) {
    throw new Error(`${expected.runtime} adapter returned false invocation evidence.`);
  }
  const evidenceKind = expected.adapterKind === 'host' ? 'host-command' : 'fixture-filesystem';
  const validHostVersion = expected.adapterKind === 'host'
    ? typeof response.invocationEvidence.hostVersion === 'string' && response.invocationEvidence.hostVersion.length > 0
    : response.invocationEvidence.hostVersion === null;
  if (response.invocationEvidence.kind !== evidenceKind || !validHostVersion) {
    throw new Error(`${expected.runtime} adapter requires ${evidenceKind} invocation evidence.`);
  }
  if (response.resourceContent !== expected.resourceContent) {
    throw new Error(`${expected.runtime} adapter returned false resource evidence.`);
  }
  if (JSON.stringify(response.hostExtensions) !== JSON.stringify(expected.hostExtensions)) {
    throw new Error(`${expected.runtime} adapter returned false host extension evidence.`);
  }
}

function adapterEntrypoint(adapter) {
  const entrypoint = resolve(adapter.entrypoint);
  if (!pathEntryExists(entrypoint)) throw new Error(`Configured adapter entrypoint does not exist: ${entrypoint}.`);
  return entrypoint;
}

function normalizedLaunch(adapter, entrypoint) {
  const environment = [...adapter.environmentNames].sort();
  if (new Set(environment).size !== environment.length) {
    throw new Error('Configured adapter environment allowlist contains duplicates.');
  }

  if (!isAbsolute(adapter.command)) {
    throw new Error('Adapter safe launch shape requires an explicitly resolved executable.');
  }
  if (adapter.command === entrypoint) {
    if (readFileSync(entrypoint).subarray(0, 2).toString('utf8') === '#!') {
      throw new Error('Adapter safe launch shape rejects direct shebang entrypoints.');
    }
    return { executable: 'entrypoint', arguments: [...adapter.args], environment };
  }
  if (adapter.command === process.execPath) {
    if (adapter.args.length === 0 || resolve(adapter.args[0]) !== entrypoint) {
      throw new Error('Node adapter safe launch shape requires the reviewed entrypoint as the fixed first script argument.');
    }
    return {
      executable: 'process.execPath',
      arguments: ['{entrypoint}', ...adapter.args.slice(1)],
      environment,
    };
  }

  throw new Error('Adapter safe launch shape requires the reviewed entrypoint executable or the current Node interpreter.');
}

function actualLaunch(adapter, environment) {
  return {
    executable: adapter.command,
    arguments: [...adapter.args],
    environment: Object.fromEntries(Object.entries(environment).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0)),
  };
}

function canonicalLaunch(launch) {
  return {
    executable: launch.executable,
    arguments: [...launch.arguments],
    environment: [...launch.environment],
  };
}

function collectFixture(root) {
  return walkFiles(root).map((relPath) => ({
    relPath,
    content: readFileSync(assertNoSymlinks(root, relPath)),
  }));
}

function fixtureDigest(resources) {
  return sha256(resources.map(({ relPath, content }) =>
    `${Buffer.byteLength(relPath, 'utf8')}:${relPath}:${sha256(content)}\n`).join(''));
}

export function validateRuntimeSmokeSuite(suite) {
  const errors = [];
  const runtimeIds = suite?.runtimes?.map(({ runtime }) => runtime) ?? [];
  if (JSON.stringify(runtimeIds) !== JSON.stringify(RUNTIMES)) {
    errors.push(`$.runtimes: expected deterministic runtime order ${RUNTIMES.join(', ')}.`);
  }
  for (const [index, runtime] of (suite?.runtimes ?? []).entries()) {
    const launch = runtime?.adapter?.launch;
    if (!launch?.arguments || !launch?.environment) continue;
    const canonical = canonicalLaunch(launch);
    if (sha256(JSON.stringify(canonical)) !== runtime.adapter.launchSha256) {
      errors.push(`$.runtimes[${index}].adapter: launch digest does not match normalized launch configuration.`);
    }
    if (canonical.executable === 'process.execPath' && canonical.arguments[0] !== '{entrypoint}') {
      errors.push(`$.runtimes[${index}].adapter: Node launch must use {entrypoint} as the first script argument.`);
    }
    const sortedEnvironment = [...canonical.environment].sort();
    if (new Set(sortedEnvironment).size !== sortedEnvironment.length
      || JSON.stringify(canonical.environment) !== JSON.stringify(sortedEnvironment)) {
      errors.push(`$.runtimes[${index}].adapter: launch environment must be unique and sorted.`);
    }
    try {
      assertSafeAdapterEnvironment(canonical.environment);
    } catch (error) {
      errors.push(`$.runtimes[${index}].adapter: ${error.message}`);
    }
  }
  return errors;
}

export function validateRuntimeSmokeResult(result) {
  const errors = [];
  const statuses = { pass: 0, fail: 0, skip: 0 };
  for (const runtime of result.runtimes ?? []) {
    statuses[runtime.status] = (statuses[runtime.status] ?? 0) + 1;
    if (runtime.status === 'pass' && runtime.checks.some(({ status }) => status !== 'pass')) {
      errors.push(`$.runtimes.${runtime.runtime}: a passing runtime contains a non-passing check.`);
    }
    if (runtime.status === 'skip' && !runtime.reason) {
      errors.push(`$.runtimes.${runtime.runtime}: a skipped runtime requires a reason.`);
    }
    if (runtime.status === 'skip' && runtime.adapter.configured) {
      for (const check of runtime.checks.slice(1)) {
        if (check.status !== 'skip' || check.reason !== runtime.reason) {
          errors.push(`$.runtimes.${runtime.runtime}: unavailable host checks must share the runtime skip reason.`);
        }
      }
    }
    if (runtime.adapter.configured
      ? (runtime.adapter.id === null
        || runtime.adapter.kind === 'none'
        || runtime.adapter.sha256 === null
        || runtime.adapter.policySha256 === null
        || runtime.adapter.launchSha256 === null)
      : (runtime.adapter.id !== null
        || runtime.adapter.kind !== 'none'
        || runtime.adapter.sha256 !== null
        || runtime.adapter.policySha256 !== null
        || runtime.adapter.launchSha256 !== null)) {
      errors.push(`$.runtimes.${runtime.runtime}: adapter identity is inconsistent with configured state.`);
    }
  }
  if (JSON.stringify(statuses) !== JSON.stringify(result.summary)) {
    errors.push('$.summary: counts do not match runtime results.');
  }
  return errors;
}

export async function runRuntimeSmokeSuite({
  suite,
  suiteDirectory,
  adapters,
  timeoutMs,
  tempBase,
  processAdapterOptions = {},
}) {
  const sourceRoot = assertNoSymlinks(suiteDirectory, suite.skill.path);
  if (!existsSync(resolve(sourceRoot, 'SKILL.md'))) throw new Error('Fixture skill does not contain SKILL.md.');
  const fixtureResources = collectFixture(sourceRoot);
  const skillResource = fixtureResources.find(({ relPath }) => relPath === 'SKILL.md');
  const sourceFrontmatter = parseFrontmatter(skillResource.content.toString('utf8')).data;
  if (sourceFrontmatter.name !== suite.skill.name) {
    throw new Error(`Fixture skill name ${sourceFrontmatter.name} does not match suite skill ${suite.skill.name}.`);
  }
  const skillSha256 = fixtureDigest(fixtureResources);
  const results = [];
  mkdirSync(tempBase, { recursive: true });

  for (const runtime of suite.runtimes) {
    const adapter = adapters.get(runtime.runtime);
    if (!adapter) {
      const reason = 'No adapter command was configured; licensed or hosted runtime was not executed.';
      results.push({
        runtime: runtime.runtime,
        status: 'skip',
        reason,
        adapter: {
          configured: false,
          id: null,
          kind: 'none',
          sha256: null,
          policySha256: null,
          launchSha256: null,
        },
        checks: skippedChecks(reason),
      });
      continue;
    }

    const root = mkdtempSync(resolve(tempBase, `${runtime.runtime}-`));
    let preserveRoot = false;
    try {
      const workspace = resolve(root, 'workspace');
      const home = resolve(root, 'home');
      mkdirSync(workspace, { recursive: true });
      mkdirSync(home, { recursive: true });
      const installRoot = assertNoSymlinks(workspace, runtime.installPath);
      const installedSkill = resolve(installRoot, suite.skill.name);
      mkdirSync(installRoot, { recursive: true });
      for (const resource of fixtureResources) {
        const destination = assertNoSymlinks(installedSkill, resource.relPath);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, resource.content, { flag: 'wx' });
      }
      const resourcePath = assertNoSymlinks(installedSkill, suite.skill.resource);
      if (!existsSync(resourcePath)) throw new Error(`Fixture resource is missing: ${suite.skill.resource}.`);
      const expected = {
        runtime: runtime.runtime,
        requestId: sha256(`${suite.name}\0${runtime.runtime}\0${skillSha256}`),
        skillName: suite.skill.name,
        invocation: runtime.invocation,
        resourceContent: readFileSync(resourcePath, 'utf8'),
        hostExtensions: extensionEvidence(installedSkill, runtime.hostExtensions),
        adapterKind: runtime.adapter.kind,
      };
      const entrypoint = adapterEntrypoint(adapter);
      if (sha256File(entrypoint) !== runtime.adapter.sha256) {
        throw new Error(`${runtime.runtime} adapter entrypoint does not match reviewed identity ${runtime.adapter.id}.`);
      }
      const launch = normalizedLaunch(adapter, entrypoint);
      const launchSha256 = sha256(JSON.stringify(launch));
      if (JSON.stringify(launch) !== JSON.stringify(canonicalLaunch(runtime.adapter.launch))
        || launchSha256 !== runtime.adapter.launchSha256) {
        throw new Error(`${runtime.runtime} adapter launch configuration does not match reviewed identity ${runtime.adapter.id}.`);
      }
      const request = {
        protocolVersion: 1,
        runtime: runtime.runtime,
        requestId: expected.requestId,
        workspace,
        home,
        installPath: runtime.installPath,
        invocation: runtime.invocation,
        hostExtensions: runtime.hostExtensions,
      };
      const environmentAdditions = { HOME: home, RUNTIME_SMOKE_RUNTIME: runtime.runtime };
      const resolvedEnvironment = buildAdapterEnvironment(adapter.environmentNames, environmentAdditions);
      const actualLaunchSha256 = sha256(JSON.stringify(actualLaunch(adapter, resolvedEnvironment)));
      const { response } = await runJsonAdapterAsync({
        ...processAdapterOptions,
        command: adapter.command,
        args: adapter.args,
        cwd: workspace,
        request,
        timeoutMs,
        environmentNames: adapter.environmentNames,
        environment: environmentAdditions,
        label: `${runtime.runtime} runtime smoke adapter`,
      });
      validateAdapterResponse(response, expected);
      const identity = {
        configured: true,
        id: runtime.adapter.id,
        kind: runtime.adapter.kind,
        sha256: runtime.adapter.sha256,
        policySha256: launchSha256,
        launchSha256: actualLaunchSha256,
      };
      if (response.status === 'skip') {
        results.push({
          runtime: runtime.runtime,
          status: 'skip',
          reason: response.reason,
          adapter: identity,
          checks: [pass('install'), ...CHECKS.slice(1).map((check) => ({ check, status: 'skip', reason: response.reason }))],
        });
      } else if (response.status === 'fail') {
        results.push({
          runtime: runtime.runtime,
          status: 'fail',
          reason: response.reason,
          adapter: identity,
          checks: [pass('install'), ...CHECKS.slice(1).map((check) => ({ check, status: 'fail', reason: response.reason }))],
        });
      } else {
        results.push({
          runtime: runtime.runtime,
          status: 'pass',
          reason: null,
          adapter: identity,
          checks: CHECKS.map(pass),
        });
      }
    } catch (error) {
      if (error?.cleanupUncertain) {
        preserveRoot = true;
        error.preservedWorkspace = root;
        error.message = `${error.message} Temporary workspace preserved at ${root} for operator cleanup.`;
      }
      throw error;
    } finally {
      if (!preserveRoot) rmSync(root, { recursive: true, force: true });
    }
  }
  return { results, skillSha256 };
}
