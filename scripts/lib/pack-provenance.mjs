import { spawnSync } from 'node:child_process';

import { computeMemberTreeDigestFromReader } from './pack-evaluations.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/;
const MAX_GIT_OUTPUT = 16 * 1024 * 1024;

function git(root, args, { encoding = 'utf8' } = {}) {
  const execution = spawnSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: MAX_GIT_OUTPUT,
    shell: false,
  });
  return execution;
}

export function resolveHeadCommit(root) {
  const execution = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const commit = execution.stdout?.trim();
  if (execution.status !== 0 || !FULL_SHA.test(commit)) {
    throw new Error('Could not resolve HEAD to a full commit SHA; Git diagnostics suppressed.');
  }
  return commit;
}

export function parseProvenanceArguments(argv, root) {
  const structuralCount = argv.filter((argument) => argument === '--structural').length;
  const ancestorCount = argv.filter((argument) => argument === '--allow-ancestor').length;
  const sourceValues = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--source-commit') continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for --source-commit.');
    sourceValues.push(value);
    index += 1;
  }
  if (structuralCount > 1 || ancestorCount > 1 || sourceValues.length > 1) {
    throw new Error('Provenance mode arguments cannot be repeated.');
  }
  if (structuralCount && sourceValues.length) {
    throw new Error('--structural and --source-commit select different modes and cannot be combined.');
  }
  if (structuralCount && ancestorCount) {
    throw new Error('--allow-ancestor is valid only with provenance mode.');
  }
  if (structuralCount) {
    return { mode: 'structural', valid: false, sourceCommit: null, allowAncestor: false };
  }
  const sourceCommit = sourceValues[0] ?? resolveHeadCommit(root);
  if (!FULL_SHA.test(sourceCommit)) {
    throw new Error('--source-commit must be exactly 40 lowercase hexadecimal characters.');
  }
  return {
    mode: 'provenance',
    valid: true,
    sourceCommit,
    allowAncestor: ancestorCount === 1,
  };
}

function exactCommit(root, sourceCommit) {
  if (!FULL_SHA.test(sourceCommit)) {
    throw new Error('--source-commit must be exactly 40 lowercase hexadecimal characters.');
  }
  const execution = git(root, ['rev-parse', '--verify', `${sourceCommit}^{commit}`]);
  if (execution.status !== 0 || execution.stdout.trim() !== sourceCommit) {
    throw new Error(`Source commit ${sourceCommit} is not an exact full commit SHA.`);
  }
}

function committedBytes(root, sourceCommit, path) {
  const execution = git(root, ['show', `${sourceCommit}:${path}`], { encoding: null });
  if (execution.status !== 0) {
    throw new Error(`Source commit ${sourceCommit} cannot reproduce required suite or member path ${path}; Git diagnostics suppressed.`);
  }
  return execution.stdout;
}

export function verifyExactPackCommit({
  root,
  sourceCommit,
  allowAncestor = false,
  suitePath,
  suiteBytes,
  registryBytes,
  registry,
  pack,
  memberTreeSha256,
}) {
  exactCommit(root, sourceCommit);
  const head = resolveHeadCommit(root);
  if (sourceCommit !== head) {
    if (!allowAncestor) {
      throw new Error(`Source commit ${sourceCommit} must equal HEAD ${head}; pass --allow-ancestor only under the documented ancestor policy.`);
    }
    const ancestor = git(root, ['merge-base', '--is-ancestor', sourceCommit, head]);
    if (ancestor.status !== 0) {
      throw new Error(`Source commit ${sourceCommit} is not an allowed ancestor of HEAD ${head}.`);
    }
  }

  const committedRegistry = committedBytes(root, sourceCommit, 'registry/skills.json');
  if (!committedRegistry.equals(registryBytes)) {
    throw new Error('Source commit registry bytes do not exactly match the current registry.');
  }
  const committedSuite = committedBytes(root, sourceCommit, suitePath);
  if (!committedSuite.equals(suiteBytes)) {
    throw new Error(`Source commit suite bytes do not exactly match ${suitePath}.`);
  }
  const historicalMemberTreeSha256 = computeMemberTreeDigestFromReader({
    pack,
    registry,
    readResource: (path) => committedBytes(root, sourceCommit, path),
  });
  if (historicalMemberTreeSha256 !== memberTreeSha256) {
    throw new Error('Source commit member tree digest does not match the suite member tree.');
  }
  return {
    mode: 'provenance',
    valid: true,
    sourceCommit,
    allowAncestor,
    memberTreeSha256: historicalMemberTreeSha256,
  };
}
