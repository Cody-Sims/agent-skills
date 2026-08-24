import { approvalDigest, pathMatches } from './continuous-improvement.mjs';

const REQUIRED_SECTIONS = [
  'Objective',
  'Baseline',
  'Changes',
  'Acceptance Criteria',
  'Validation And Evaluation',
  'Before And After Results',
  'Sources And Provenance',
  'Risks And Limitations',
  'Unresolved Findings',
  'Rollback',
  'Final State',
];

function nonEmptyStrings(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function samePaths(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  return left.length === right.length && left.every((path) => right.includes(path));
}

function section(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const content = body.match(new RegExp(`(?:^|\\n)## ${escaped}\\s*\\n\\s*([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? '';
  return content.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function marker(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(new RegExp(`^${escaped}:\\s*(\\S+)\\s*$`, 'm'))?.[1] ?? null;
}

function validateItemAndLease({ items, run, output, now }, errors) {
  if (!Array.isArray(items) || items.length !== 1) {
    errors.push('Improvement output requires exactly one approved item.');
    return null;
  }

  const item = items[0];
  if (!item.approval) {
    errors.push('Item has no current maintainer approval.');
  } else if (item.approval.payloadSha256 !== approvalDigest(item)) {
    errors.push('Item approval is stale.');
  }
  const approvalTransition = item.transitions?.find((transition) => (
    transition.from === 'proposed'
    && transition.to === 'ready'
    && transition.role === 'maintainer'
    && transition.actor === item.approval?.actor
  ));
  if (item.approval && !approvalTransition) errors.push('Item has no maintainer approval transition.');
  if (item.status !== 'in-progress') errors.push('Approved item must be in-progress while implementation is leased.');
  if (!Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0) {
    errors.push('Approved item requires complete acceptance criteria.');
  }
  if (!Array.isArray(item.allowedPaths) || item.allowedPaths.length === 0) {
    errors.push('Approved item requires an explicit path scope.');
  }
  if (!Array.isArray(item.requiredChecks) || item.requiredChecks.length === 0) {
    errors.push('Approved item requires independent checks.');
  }
  if (!item.lease) {
    errors.push('Approved item has no active lease.');
  } else {
    if (item.lease.owner !== 'skill-improvement') errors.push('Item lease is not owned by the skill-improvement agent.');
    if (item.lease.runId !== run?.runId || item.lease.id !== run?.leaseId) {
      errors.push('Run does not own the approved item lease.');
    }
    const expiresAt = timestamp(item.lease.expiresAt);
    const currentTime = timestamp(now);
    if (expiresAt === null || currentTime === null || expiresAt <= currentTime) {
      errors.push('Item lease has expired or has an invalid expiry.');
    }
  }
  if (run?.itemId !== item.id) errors.push('Run item ID does not match the approved item.');
  if (run?.agent !== 'skill-improvement') errors.push('Run agent must be skill-improvement.');
  if (!Array.isArray(output?.itemIds)
    || output.itemIds.length !== 1
    || output.itemIds[0] !== item.id) {
    errors.push('Output must identify exactly the leased improvement item.');
  }
  if (output?.approvalSha256 !== item.approval?.payloadSha256) {
    errors.push('Output approval digest does not match the current item.');
  }
  if (output?.leaseId !== item.lease?.id) errors.push('Output lease ID does not match the active lease.');
  return item;
}

function validateBaseline(output, errors) {
  const capturedAt = timestamp(output?.baseline?.capturedAt);
  const firstEditAt = timestamp(output?.firstEditAt);
  if (capturedAt === null || typeof output?.baseline?.evidence !== 'string'
    || output.baseline.evidence.trim().length === 0) {
    errors.push('Baseline requires timestamped evidence.');
  }
  if (firstEditAt === null) errors.push('First edit time is required.');
  if (capturedAt !== null && firstEditAt !== null && capturedAt >= firstEditAt) {
    errors.push('Baseline evidence must be captured before the first edit.');
  }
}

function validateScope({ item, run, output, policy }, errors) {
  const allowedPermissions = policy?.approvedPermissions;
  if (!Array.isArray(allowedPermissions) || allowedPermissions.length === 0) {
    errors.push('Policy must define a nonempty approvedPermissions allowlist.');
  }
  for (const permission of run?.permissions ?? []) {
    const allowed = Array.isArray(allowedPermissions)
      && allowedPermissions.includes(permission);
    if (!allowed) errors.push(`Permission is outside the improvement-agent boundary: ${permission}.`);
  }

  if (!samePaths(run?.changedPaths, output?.changedPaths)) {
    errors.push('Output paths must exactly match the run changed paths.');
  }
  if (!Array.isArray(run?.changedPaths) || run.changedPaths.length === 0) {
    errors.push('A draft-ready result must report at least one changed path.');
  }
  for (const path of run?.changedPaths ?? []) {
    if (!(item.allowedPaths ?? []).some((pattern) => pathMatches(path, pattern))) {
      errors.push(`Changed path is outside the approved scope: ${path}.`);
    }
    const protectedPath = (policy?.protectedPaths ?? []).some((pattern) => pathMatches(path, pattern));
    const explicitlyApproved = (item.approvedProtectedPaths ?? []).some((pattern) => pathMatches(path, pattern));
    if (protectedPath && !explicitlyApproved) {
      errors.push(`Protected path lacks explicit approval: ${path}.`);
    }
  }
}

function validateAcceptanceCriteria(item, output, errors) {
  if (!Array.isArray(output?.acceptanceCriteria)) {
    errors.push('Acceptance-criteria results are required.');
    return;
  }
  const results = new Map();
  for (const result of output.acceptanceCriteria) {
    if (results.has(result?.id)) {
      errors.push(`Acceptance criterion is reported more than once: ${result?.id}.`);
      continue;
    }
    results.set(result?.id, result);
  }
  for (const criterion of item.acceptanceCriteria ?? []) {
    const result = results.get(criterion.id);
    if (!result) {
      errors.push(`Acceptance criterion has no result: ${criterion.id}.`);
      continue;
    }
    if (result.passed !== true) {
      errors.push(`Acceptance criterion did not pass: ${criterion.id}.`);
    }
    if (typeof result.evidence !== 'string' || result.evidence.trim().length === 0) {
      errors.push(`Acceptance criterion has no evidence: ${criterion.id}.`);
    }
  }
  for (const id of results.keys()) {
    if (!(item.acceptanceCriteria ?? []).some((criterion) => criterion.id === id)) {
      errors.push(`Output reports an unknown acceptance criterion: ${id}.`);
    }
  }
}

function validateGates(item, run, output, errors) {
  const checks = new Map((run?.checks ?? []).map((check) => [check.name, check]));
  for (const check of run?.checks ?? []) {
    if (!check.passed) errors.push(`Check failed: ${check.name}.`);
    if (check.regressed === true) errors.push(`Check regressed: ${check.name}.`);
    if (typeof check.evidence !== 'string' || check.evidence.trim().length === 0) {
      errors.push(`Check has no evidence: ${check.name}.`);
    }
    if (!run?.headCommit || check.headCommit !== run.headCommit) {
      errors.push(`Check is not bound to the current head commit: ${check.name}.`);
    }
  }
  for (const required of item.requiredChecks ?? []) {
    if (!checks.has(required)) errors.push(`Required check has no result: ${required}.`);
  }

  const independentGates = output?.independentGates ?? [];
  const gates = new Map(independentGates.map((gate) => [gate.name, gate]));
  for (const gate of independentGates) {
    const evidencePresent = typeof gate.before?.evidence === 'string'
      && gate.before.evidence.trim().length > 0
      && typeof gate.after?.evidence === 'string'
      && gate.after.evidence.trim().length > 0;
    if (gate.preserved !== true || gate.before?.passed !== true || gate.after?.passed !== true) {
      errors.push(`Independent gate was not preserved: ${gate.name}.`);
    }
    if (!evidencePresent) errors.push(`Independent gate lacks before-and-after evidence: ${gate.name}.`);
  }
  for (const required of item.requiredChecks ?? []) {
    const gate = gates.get(required);
    if (!gate) {
      errors.push(`Independent gate has no before-and-after result: ${required}.`);
    }
  }
}

function validateGrounding(output, errors) {
  if (!Array.isArray(output?.sources) || output.sources.length === 0) {
    errors.push('At least one source link is required.');
  } else {
    for (const source of output.sources) {
      try {
        const url = new URL(source);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        errors.push(`Source must be an HTTP or HTTPS link: ${source}.`);
      }
    }
  }

  if (!Array.isArray(output?.beforeAfterResults) || output.beforeAfterResults.length === 0
    || output.beforeAfterResults.some((result) => (
      typeof result.measure !== 'string' || !result.measure.trim()
      || typeof result.before !== 'string' || !result.before.trim()
      || typeof result.after !== 'string' || !result.after.trim()
    ))) {
    errors.push('Complete before-and-after results are required.');
  }
  if (!nonEmptyStrings(output?.risks)) errors.push('Risks and limitations are required.');
  if (!nonEmptyStrings(output?.unresolvedFindings)) errors.push('Unresolved findings are required, including an explicit None entry.');
  if (!nonEmptyStrings(output?.rollbackInstructions)) errors.push('Rollback instructions are required.');
}

function validatePullRequest(item, run, output, errors) {
  const pullRequest = output?.pullRequest;
  if (pullRequest?.draft !== true) errors.push('Pull request must remain in draft state.');
  if (pullRequest?.approved === true) errors.push('The improvement agent must not approve its own pull request.');
  if (pullRequest?.merged === true) errors.push('The improvement agent must not merge its own pull request.');
  if (output?.finalState !== 'draft-ready') errors.push('Complete improvement output must finish as draft-ready.');

  const body = typeof pullRequest?.body === 'string' ? pullRequest.body : '';
  for (const heading of REQUIRED_SECTIONS) {
    if (!section(body, heading)) errors.push(`PR body section is missing or empty: ${heading}.`);
  }

  if ([...body.matchAll(/^Improvement-Item:\s*#\d+\s*$/gm)].length !== 1) {
    errors.push('PR body must identify exactly one improvement item.');
  }
  if (marker(body, 'Improvement-Lease') !== item.lease?.id) errors.push('PR body lease marker is invalid.');
  if (marker(body, 'Improvement-Approval') !== item.approval?.payloadSha256) errors.push('PR body approval marker is invalid.');
  if (marker(body, 'Improvement-Run') !== run?.runId) errors.push('PR body run marker is invalid.');
  if (marker(body, 'Pull-Request-State') !== 'draft') errors.push('PR body must declare draft state.');
  if (marker(body, 'Self-Approval') !== 'false' || marker(body, 'Merge-Claim') !== 'false') {
    errors.push('PR body must disclaim self-approval and merge authority.');
  }

  const baseline = section(body, 'Baseline');
  if (!baseline.includes(output?.baseline?.capturedAt ?? '')
    || !baseline.includes(output?.firstEditAt ?? '')
    || !baseline.includes(output?.baseline?.evidence ?? '')) {
    errors.push('PR body baseline does not match the timestamped baseline evidence.');
  }
  const changes = section(body, 'Changes');
  for (const path of output?.changedPaths ?? []) {
    if (!changes.includes(path)) errors.push(`PR body does not report changed path: ${path}.`);
  }
  const validation = section(body, 'Validation And Evaluation');
  for (const required of item.requiredChecks ?? []) {
    if (!validation.includes(required)) errors.push(`PR body does not report required check: ${required}.`);
  }
  const acceptanceCriteria = section(body, 'Acceptance Criteria');
  for (const result of output?.acceptanceCriteria ?? []) {
    for (const value of [
      result.id,
      result.passed === true ? 'passed' : 'failed',
      result.evidence,
    ]) {
      if (!acceptanceCriteria.includes(value)) {
        errors.push(`PR body does not report acceptance-criterion evidence: ${value}.`);
      }
    }
  }
  const sources = section(body, 'Sources And Provenance');
  for (const source of output?.sources ?? []) {
    if (!sources.includes(source)) errors.push(`PR body does not report source link: ${source}.`);
  }
  const beforeAfter = section(body, 'Before And After Results');
  for (const result of output?.beforeAfterResults ?? []) {
    for (const value of [result.measure, result.before, result.after]) {
      if (!beforeAfter.includes(value)) errors.push(`PR body does not report before-and-after value: ${value}.`);
    }
  }
  const risks = section(body, 'Risks And Limitations');
  for (const risk of output?.risks ?? []) {
    if (!risks.includes(risk)) errors.push(`PR body does not report risk: ${risk}.`);
  }
  const unresolved = section(body, 'Unresolved Findings');
  for (const finding of output?.unresolvedFindings ?? []) {
    if (!unresolved.includes(finding)) errors.push(`PR body does not report unresolved finding: ${finding}.`);
  }
  const rollback = section(body, 'Rollback');
  for (const instruction of output?.rollbackInstructions ?? []) {
    if (!rollback.includes(instruction)) errors.push(`PR body does not report rollback instruction: ${instruction}.`);
  }
  const finalState = section(body, 'Final State').replaceAll('`', '').trim();
  if (finalState !== 'draft-ready') errors.push('PR body final state must be draft-ready.');

  const authorityClaim = /\b(?:(?:the\s+)?(?:improvement\s+)?agent|I|we)\s+(?:have\s+|has\s+)?(?:approved|merged)\b/i;
  if (authorityClaim.test(body)) errors.push('The improvement agent must not claim approval or merge authority.');
}

export function validateImprovementOutput({
  items,
  run,
  output,
  policy = {},
  now = new Date().toISOString(),
}) {
  const errors = [];
  const item = validateItemAndLease({ items, run, output, now }, errors);
  if (!item) return errors;
  validateBaseline(output, errors);
  validateScope({ item, run, output, policy }, errors);
  validateAcceptanceCriteria(item, output, errors);
  validateGates(item, run, output, errors);
  validateGrounding(output, errors);
  validatePullRequest(item, run, output, errors);
  return errors;
}

export const validateImprovementPr = validateImprovementOutput;
