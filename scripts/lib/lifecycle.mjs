import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseFrontmatter } from './frontmatter.mjs';
import { validateAgainstSchema } from './jsonschema.mjs';
import { discoverSkills } from './skills.mjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value) {
  if (!DATE_PATTERN.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validateRecordDates(record, path, asOf, errors) {
  for (const field of ['lastReviewedAt', 'reviewDueAt']) {
    if (record?.[field] !== undefined && !isCalendarDate(record[field])) {
      errors.push(`${path}.${field}: must be a valid calendar date.`);
    }
  }
  if (isCalendarDate(record?.lastReviewedAt) && isCalendarDate(record?.reviewDueAt)
    && record.reviewDueAt <= record.lastReviewedAt) {
    errors.push(`${path}.reviewDueAt: reviewDueAt must be after lastReviewedAt.`);
  }
  if (isCalendarDate(record?.lastReviewedAt) && isCalendarDate(asOf)
    && record.lastReviewedAt > asOf) {
    errors.push(`${path}.lastReviewedAt: lastReviewedAt must not be after --as-of ${asOf}.`);
  }
  if (isCalendarDate(record?.lastReviewedAt) && isCalendarDate(record?.reviewDueAt)
    && record.reviewDueAt > oneYearAfter(record.lastReviewedAt)) {
    errors.push(`${path}.reviewDueAt: review interval must not exceed one calendar year.`);
  }
  if (isCalendarDate(record?.reviewDueAt) && isCalendarDate(asOf) && record.reviewDueAt < asOf) {
    errors.push(`${path}.reviewDueAt: review expired before --as-of ${asOf}.`);
  }
}

function oneYearAfter(value) {
  const [year, month, day] = value.split('-').map(Number);
  let candidateDay = day;
  while (candidateDay > 0) {
    const candidate = `${String(year + 1).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(candidateDay).padStart(2, '0')}`;
    if (isCalendarDate(candidate)) return candidate;
    candidateDay -= 1;
  }
  throw new Error(`Cannot calculate review anniversary for ${value}.`);
}

export function annualReviewDueAt(lastReviewedAt) {
  return oneYearAfter(lastReviewedAt);
}

export function exceedsAnnualReviewInterval(lastReviewedAt, reviewDueAt) {
  return isCalendarDate(lastReviewedAt)
    && isCalendarDate(reviewDueAt)
    && reviewDueAt > oneYearAfter(lastReviewedAt);
}

export function normalizeRepositoryUrl(repository) {
  if (typeof repository !== 'string') return repository;
  let normalized = repository;
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (normalized.endsWith('.git')) normalized = normalized.slice(0, -4);
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function validateOrigin(origin, path, errors) {
  if (!origin || typeof origin !== 'object') return;
  if (origin.ref !== origin.commit) {
    errors.push(`${path}: immutable ref must equal the full commit SHA.`);
  }
  if (origin.type === 'first-party'
    && normalizeRepositoryUrl(origin.repository) !== 'https://github.com/Cody-Sims/agent-skills') {
    errors.push(`${path}.repository: first-party origin must identify this repository.`);
  }
}

export function validateLifecycle(schema, manifest, skillsRoot, asOf, discoveryManifest = null) {
  const errors = validateAgainstSchema(schema, manifest);
  if (!isCalendarDate(asOf)) {
    errors.push('$: --as-of must be a valid calendar date in YYYY-MM-DD form.');
    return errors;
  }
  const discovered = discoverSkills(skillsRoot);
  const names = new Set(discovered.map((skill) => skill.name));
  const records = manifest?.skills && typeof manifest.skills === 'object' ? manifest.skills : {};
  const removed = manifest?.removed && typeof manifest.removed === 'object' ? manifest.removed : {};

  for (const skill of discovered) {
    const record = records[skill.name];
    if (!record) {
      errors.push(`$.skills: missing lifecycle metadata for ${skill.name}.`);
      continue;
    }
    const { data } = parseFrontmatter(readFileSync(resolve(skill.dir, 'SKILL.md'), 'utf8'));
    if (record.license !== data.license) {
      errors.push(`$.skills.${skill.name}.license: license does not match SKILL.md.`);
    }
  }
  for (const name of Object.keys(records)) {
    if (!names.has(name)) errors.push(`$.skills.${name}: lifecycle references unknown skill.`);
  }
  for (const name of Object.keys(removed)) {
    if (names.has(name)) errors.push(`$.removed.${name}: removed tombstone matches an active skill.`);
  }

  const all = new Map([...Object.entries(records), ...Object.entries(removed)]);
  for (const [name, record] of all) {
    const path = names.has(name) ? `$.skills.${name}` : `$.removed.${name}`;
    validateRecordDates(record, path, asOf, errors);
    validateOrigin(record?.origin, `${path}.origin`, errors);
    const runtimeCompatibility = discoveryManifest?.skills?.[name]?.runtimeCompatibility;
    const compatibilitySensitive = names.has(name)
      && Array.isArray(runtimeCompatibility)
      && runtimeCompatibility.some((runtime) => runtime?.status !== 'compatible');
    if (record?.origin?.type === 'external' && record.reviewDueAt === undefined) {
      errors.push(`${path}.reviewDueAt: external skills require a scheduled review.`);
    } else if (compatibilitySensitive && record.reviewDueAt === undefined) {
      errors.push(`${path}.reviewDueAt: compatibility-sensitive skills require a scheduled review.`);
    }
    if (record?.status === 'superseded' && !record.replacement) {
      errors.push(`${path}.replacement: superseded skills require a replacement.`);
    }
    if (record?.replacement) {
      if (record.replacement === name) {
        errors.push(`${path}.replacement: replacement must not reference itself.`);
      } else if (removed[record.replacement]) {
        errors.push(`${path}.replacement: replacement must not be removed.`);
      } else if (!records[record.replacement]) {
        errors.push(`${path}.replacement: replacement does not exist.`);
      }
    }
  }

  for (const start of all.keys()) {
    const seen = new Set();
    let current = start;
    while (all.get(current)?.replacement) {
      if (seen.has(current)) {
        errors.push(`$.lifecycle: replacement cycle includes ${current}.`);
        break;
      }
      seen.add(current);
      current = all.get(current).replacement;
    }
  }
  return [...new Set(errors)];
}

export function normalizeLifecycle(manifest) {
  const compareCodePoints = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  const normalizeMap = (records) => Object.fromEntries(
    Object.entries(records ?? {})
      .sort(([a], [b]) => compareCodePoints(a, b))
      .map(([name, record]) => {
        const normalized = structuredClone(record);
        if (normalized?.origin) {
          normalized.origin.repository = normalizeRepositoryUrl(normalized.origin.repository);
        }
        return [name, normalized];
      }),
  );
  return {
    schemaVersion: manifest.schemaVersion,
    skills: normalizeMap(manifest.skills),
    removed: normalizeMap(manifest.removed),
  };
}

function normalizedOrigin(origin) {
  if (!origin) return null;
  return {
    type: origin.type,
    repository: normalizeRepositoryUrl(origin.repository),
    ref: origin.ref,
    commit: origin.commit,
  };
}

function sameOrigin(left, right) {
  return JSON.stringify(normalizedOrigin(left)) === JSON.stringify(normalizedOrigin(right));
}

function registryLifecycleRecords(registry) {
  const records = new Map();
  for (const skill of registry?.skills ?? []) {
    if (!skill.lifecycle) continue;
    records.set(skill.name, {
      state: 'active',
      version: skill.version,
      lifecycle: skill.lifecycle,
    });
  }
  for (const [name, lifecycle] of Object.entries(registry?.removed ?? {})) {
    records.set(name, { state: 'removed', version: null, lifecycle });
  }
  return records;
}

export function validateOriginTransitions(previousRegistry, currentRegistry) {
  const errors = [];
  const previous = registryLifecycleRecords(previousRegistry);
  const current = registryLifecycleRecords(currentRegistry);
  for (const [name, before] of previous) {
    const after = current.get(name);
    if (!after) {
      errors.push(`skill ${name}: removal requires a lifecycle tombstone.`);
      continue;
    }
    if (before.state === 'removed' && after.state === 'active') {
      errors.push(`skill ${name}: removed-to-active transition is not allowed.`);
      continue;
    }
    if (sameOrigin(before.lifecycle?.origin, after.lifecycle?.origin)) continue;
    const beforeType = before.lifecycle?.origin?.type;
    const afterType = after.lifecycle?.origin?.type;
    if (beforeType !== afterType) {
      errors.push(`skill ${name}: origin kind changed from ${beforeType} to ${afterType}.`);
      continue;
    }
    if (before.state === 'active' && after.state === 'active' && beforeType === 'external') {
      const versionAdvanced = compareSemver(after.version, before.version) > 0;
      const reviewAdvanced = after.lifecycle.lastReviewedAt > before.lifecycle.lastReviewedAt;
      if (!versionAdvanced || !reviewAdvanced) {
        errors.push(`skill ${name}: external upstream identity changed without both a version increase and an advanced lastReviewedAt.`);
      }
    } else if (before.state === 'active' && after.state === 'removed') {
      errors.push(`skill ${name}: active-to-removed origin identity changed.`);
    } else if (before.state === 'removed' && after.state === 'removed') {
      errors.push(`skill ${name}: tombstone origin identity changed.`);
    } else if (beforeType === 'first-party') {
      errors.push(`skill ${name}: first-party origin identity changed.`);
    } else {
      errors.push(`skill ${name}: lifecycle origin identity changed.`);
    }
  }
  return errors;
}

function compareSemver(left, right) {
  if (!/^\d+\.\d+\.\d+$/.test(left ?? '') || !/^\d+\.\d+\.\d+$/.test(right ?? '')) return 0;
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}
