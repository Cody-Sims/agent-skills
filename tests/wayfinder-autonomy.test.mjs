import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKILL = readFileSync(resolve(REPO_ROOT, 'skills/wayfinder-planning/SKILL.md'), 'utf8');
const AUTONOMY_REFERENCE = readFileSync(
  resolve(REPO_ROOT, 'skills/wayfinder-planning/references/autonomy-loop.md'),
  'utf8',
);
const BEHAVIOR_SUITE = JSON.parse(readFileSync(
  resolve(REPO_ROOT, 'evals/skills/wayfinder-planning/evals.json'),
  'utf8',
));
const SKILL_ROUTING_SUITE = JSON.parse(readFileSync(
  resolve(REPO_ROOT, 'evals/skills/wayfinder-planning/routing.json'),
  'utf8',
));
const CATALOG_ROUTING_SUITE = JSON.parse(readFileSync(
  resolve(REPO_ROOT, 'evals/routing.json'),
  'utf8',
));

function behaviorCase(id) {
  const entry = BEHAVIOR_SUITE.cases.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing behavior case: ${id}`);
  return entry;
}

function routingCase(suite, id) {
  const entry = suite.cases.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing routing case: ${id}`);
  return entry;
}

function expectMatch(value, pattern, message) {
  assert.ok(pattern.test(value), message);
}

function expectAbsent(value, pattern, message) {
  assert.ok(!pattern.test(value), message);
}

test('Wayfinder specifies sequential autonomous continuation after verified synchronization', () => {
  expectMatch(SKILL, /sequential/i, 'SKILL.md must declare sequential continuation');
  expectMatch(SKILL, /autonomous[\s-]+continuation/i, 'SKILL.md must declare autonomous continuation');
  expectMatch(
    SKILL,
    /atomic(?:ally)?[\s\S]{0,120}(?:synchron|sync)[\s\S]{0,120}verif/i,
    'SKILL.md must verify atomic synchronization before continuing',
  );
  expectMatch(
    SKILL,
    /(?:re-read|reread)[\s\S]{0,160}(?:recompute|frontier)[\s\S]{0,160}(?:next claim|claim)/i,
    'SKILL.md must reread and recompute before the next claim',
  );
  expectMatch(
    SKILL,
    /(?:only after|after)[\s\S]{0,120}(?:claim|ticket)[\s\S]{0,120}(?:consumed|verified absent)/i,
    'SKILL.md must gate continuation on a consumed or verified-absent claim',
  );
});

test('Wayfinder limits controller ownership and keeps parallel workers claimless', () => {
  expectMatch(SKILL, /at most one live claim/i, 'SKILL.md must allow at most one live claim');
  expectMatch(
    SKILL,
    /parallel workers?[\s\S]{0,120}read-only[\s\S]{0,120}claimless/i,
    'SKILL.md must keep parallel workers read-only and claimless',
  );
  expectMatch(
    SKILL,
    /controller[\s\S]{0,120}at most one claim/i,
    'SKILL.md must limit the controller to at most one claim',
  );
});

test('Wayfinder keeps core execution in SKILL.md and links detailed autonomy reference', () => {
  expectMatch(
    SKILL,
    /\[autonomy-loop detail\]\(references\/autonomy-loop\.md\)/i,
    'SKILL.md must link the autonomy-loop reference directly',
  );
  for (const field of [
    'dispatched_operations',
    'worker_operations',
    'input_utf8_bytes',
    'output_utf8_bytes',
    'completed_digest',
    'recent_completed',
    'operation_index',
    'original_request_sha256',
    'allowed_handoff',
    'verifier_id',
    'evaluateAutonomyTrace',
    'violation_codes',
    'blocked-frontier',
    'hard-budget-exhaustion',
  ]) {
    expectMatch(
      AUTONOMY_REFERENCE,
      new RegExp(field.replaceAll('_', '[_-]'), 'i'),
      `autonomy-loop reference must document ${field}`,
    );
  }
});

test('Wayfinder has no default ticket cap and does not ask for generic continuation', () => {
  expectMatch(
    SKILL,
    /(?:no|without|never)[\s\S]{0,100}default[\s-]?ticket[- ]count cap/i,
    'SKILL.md must state that there is no default ticket-count cap',
  );
  expectMatch(
    SKILL,
    /(?:no|without|never|do not)[\s\S]{0,100}(?:generic[\s-]+)?["“']?continue\/next\?["”']?[\s\S]{0,100}prompt/i,
    'SKILL.md must prohibit a generic continue/next? prompt',
  );
});

test('Wayfinder defines default budgets, protected reserves, and a minimum reserve', () => {
  expectMatch(SKILL, /30\s+minutes/i, 'SKILL.md must set a 30-minute default budget');
  expectMatch(SKILL, /64\s*k(?:ilo)?[\s-]+normalized\s+token\s+units/i, 'SKILL.md must set a 64k normalized-token default budget');
  expectMatch(SKILL, /64\s+tool\s+calls/i, 'SKILL.md must set a 64-call default budget');
  expectMatch(SKILL, /5\s+minutes[\s\S]{0,120}12\s*k(?:ilo)?[\s-]+tokens?[\s\S]{0,120}12\s+calls/i, 'SKILL.md must set protected reserves');
  expectMatch(SKILL, /2\s+minutes[\s\S]{0,120}4\s*k(?:ilo)?[\s-]+tokens?[\s\S]{0,120}6\s+calls/i, 'SKILL.md must set minimum reserves');
});

test('Wayfinder preserves reserve for safe progress and reporting operations', () => {
  for (const operation of [
    'progress',
    'reconciliation',
    'block',
    'release',
    'read[- ]fence',
    'checkpoint',
    'report',
  ]) {
    expectMatch(SKILL, new RegExp(operation, 'i'), `missing reserve operation: ${operation}`);
  }
  expectMatch(
    SKILL,
    /preserv(?:e|ing)[\s\S]{0,160}(?:reserve|budget)[\s\S]{0,240}(?:progress|reconciliation|block|release)/i,
    'SKILL.md must preserve reserve for progress and reconciliation operations',
  );
});

test('Wayfinder stops only for substantive conditions or exhausted hard budget', () => {
  for (const condition of [
    'human grilling',
    'authorization',
    'policy input',
    'ambiguous scope',
    'blocked',
    'claimed',
    'empty frontier',
    'map clear',
    'safety',
    'recovery failure',
    'exhausted hard budget',
  ]) {
    expectMatch(SKILL, new RegExp(condition, 'i'), `missing stop condition: ${condition}`);
  }
});

test('Wayfinder hands off implementation requests without self-approval or delivery work', () => {
  expectMatch(SKILL, /requirements-and-spec-writing/i, 'SKILL.md must name requirements-and-spec-writing');
  expectMatch(
    SKILL,
    /(?:original implementation request|implementation request)[\s\S]{0,180}(?:clear|handoff|hand off)/i,
    'SKILL.md must hand off a clear original implementation request',
  );
  expectMatch(SKILL, /planning-and-task-breakdown/i, 'SKILL.md must name planning-and-task-breakdown');
  expectMatch(
    SKILL,
    /planning-and-task-breakdown[\s\S]{0,400}(?:approved specification|specification approval)/i,
    'SKILL.md must require specification approval before planning',
  );
  expectMatch(SKILL, /(?:no|never|do not)[\s\S]{0,100}(?:self[- ]approval|approve its own)/i, 'SKILL.md must prohibit self-approval');
  expectMatch(SKILL, /(?:no|never|do not)[\s\S]{0,100}implementation/i, 'SKILL.md must prohibit implementation');
  expectMatch(SKILL, /(?:no|never|do not)[\s\S]{0,100}agent execution/i, 'SKILL.md must prohibit agent execution');
  expectMatch(SKILL, /(?:no|never|do not)[\s\S]{0,100}(?:Git|pull[- ]request) work/i, 'SKILL.md must prohibit Git and pull-request work');
});

test('the resume behavior case specifies two cycles and verified autonomous handoff', () => {
  const entry = behaviorCase('resolve-one-frontier-ticket');
  assert.match(entry.prompt, /at least two sequential(?: frontier)? cycles/i);
  const assertions = new Map(entry.assertions.map((assertion) => [assertion.id, assertion]));
  for (const id of [
    'two-sequential-cycles',
    'verified-sync-before-second-claim',
    'one-live-claim',
    'budget-and-reserve',
    'reserve-preservation',
    'automatic-continuation',
    'substantive-stop-conditions',
    'no-continuation-prompt',
  ]) {
    assert.ok(assertions.has(id), `missing behavior assertion: ${id}`);
  }
  assert.match(assertions.get('two-sequential-cycles').value, /first|cycle 1/i);
  assert.match(assertions.get('two-sequential-cycles').value, /second|cycle 2/i);
  assert.match(assertions.get('verified-sync-before-second-claim').value, /verif/i);
  assert.match(assertions.get('verified-sync-before-second-claim').value, /synchron/i);
  assert.match(assertions.get('reserve-preservation').value, /progress/i);
  assert.match(assertions.get('reserve-preservation').value, /read\[- \]fence/i);
  assert.match(assertions.get('reserve-preservation').value, /report/i);
  assert.match(assertions.get('automatic-continuation').value, /automatic/i);
  assert.equal(assertions.get('no-continuation-prompt').type, 'notContains');
  assert.match(assertions.get('no-continuation-prompt').value, /continue\/next\?/i);
});

test('Wayfinder resume routing prompts positively describe autonomous continuation', () => {
  const skillResume = routingCase(SKILL_ROUTING_SUITE, 'training-positive-resume');
  assert.match(skillResume.prompt, /autonomously/i);
  assert.match(skillResume.prompt, /sequential/i);
  assert.match(skillResume.prompt, /verif(?:y|ied)/i);
  assert.match(skillResume.prompt, /one live claim/i);
  assert.deepEqual(skillResume.excluded, []);

  const catalogResume = routingCase(CATALOG_ROUTING_SUITE, 'resume-wayfinder-frontier');
  assert.match(catalogResume.prompt, /autonomously/i);
  assert.match(catalogResume.prompt, /verif(?:y|ied)/i);
  assert.match(catalogResume.prompt, /substantive stop conditions/i);
  assert.deepEqual(catalogResume.expected, ['wayfinder-planning']);
  assert.deepEqual(catalogResume.excluded, [
    'requirements-and-spec-writing',
    'planning-and-task-breakdown',
    'parallel-worktree-delivery',
    'git-and-pr-workflow',
  ]);
});

test('the old one-decision stop contract is rejected', () => {
  expectAbsent(SKILL, /one-decision-per-session/i, 'SKILL.md still contains one-decision-per-session');
  expectAbsent(SKILL, /resolve exactly one ticket/i, 'SKILL.md still says resolve exactly one ticket');
  expectAbsent(SKILL, /then stop/i, 'SKILL.md still says then stop');
  expectAbsent(SKILL, /stop immediately/i, 'SKILL.md still says stop immediately');
  expectAbsent(SKILL, /single ticket resolved/i, 'SKILL.md still says single ticket resolved');
});
