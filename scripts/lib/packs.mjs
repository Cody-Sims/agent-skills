import { validateAgainstSchema } from './jsonschema.mjs';

const SEMVER = /^\d+\.\d+\.\d+$/;

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function compareSemver(left, right) {
  if (!SEMVER.test(left ?? '') || !SEMVER.test(right ?? '')) return 0;
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function normalizePacks(manifest) {
  const packs = (manifest.packs ?? [])
    .map((pack) => ({
      ...structuredClone(pack),
      skills: [...(pack.skills ?? [])]
        .sort((a, b) => compareCodePoints(a.name, b.name)),
      handoffs: [...(pack.handoffs ?? [])],
      conflicts: [...(pack.conflicts ?? [])].sort(compareCodePoints),
      installPolicy: {
        ...structuredClone(pack.installPolicy),
        requiredRuntimes: [...(pack.installPolicy?.requiredRuntimes ?? [])]
          .sort(compareCodePoints),
      },
    }))
    .sort((a, b) => compareCodePoints(a.name, b.name));
  const removed = Object.fromEntries(
    Object.entries(manifest.removed ?? {}).sort(([a], [b]) => compareCodePoints(a, b)),
  );
  return { schemaVersion: manifest.schemaVersion, packs, removed };
}

export function validatePackManifest(schema, manifest, registrySkills) {
  const errors = validateAgainstSchema(schema, manifest);
  if (!Array.isArray(manifest?.packs)) return errors;
  const skills = new Map(
    (Array.isArray(registrySkills) ? registrySkills : [])
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => [entry.name, entry]),
  );
  const packNames = manifest.packs
    .filter((pack) => pack && typeof pack.name === 'string')
    .map((pack) => pack.name);
  for (const duplicate of uniqueDuplicates(packNames)) {
    errors.push(`$.packs: duplicate pack ${duplicate}.`);
  }
  for (const [packIndex, pack] of manifest.packs.entries()) {
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) continue;
    const path = `$.packs[${packIndex}]`;
    const members = Array.isArray(pack.skills) ? pack.skills : [];
    const memberNames = members
      .filter((member) => member && typeof member.name === 'string')
      .map((member) => member.name);
    const included = new Set(memberNames);
    for (const duplicate of uniqueDuplicates(memberNames)) {
      errors.push(`${path}.skills: duplicate member ${duplicate}.`);
    }
    for (const [memberIndex, member] of members.entries()) {
      if (!member || typeof member !== 'object' || typeof member.name !== 'string') continue;
      const registered = skills.get(member.name);
      if (!registered) {
        errors.push(`${path}.skills[${memberIndex}]: unknown skill ${member.name}.`);
        continue;
      }
      if (member.version !== registered.version) {
        errors.push(
          `${path}.skills[${memberIndex}].${member.name}: pack requires version `
          + `${member.version}, registry has ${registered.version}.`,
        );
      }
      if (registered.lifecycle?.status !== 'active') {
        errors.push(
          `${path}.skills[${memberIndex}].${member.name}: pack members must have active lifecycle status.`,
        );
      }
      for (const conflict of registered.discovery?.conflictingSkills ?? []) {
        if (included.has(conflict)) {
          errors.push(`${path}: ${member.name} conflicts with included member ${conflict}.`);
        }
      }
      for (const runtime of pack.installPolicy?.requiredRuntimes ?? []) {
        const compatibility = registered.discovery?.runtimeCompatibility
          ?.find((entry) => entry.runtime === runtime);
        if (compatibility?.status !== 'compatible') {
          errors.push(`${path}: ${member.name} is not compatible with required runtime ${runtime}.`);
        }
      }
    }
    const handoffs = Array.isArray(pack.handoffs) ? pack.handoffs : [];
    const handoffKeys = handoffs
      .filter((handoff) => handoff && typeof handoff.from === 'string'
        && typeof handoff.to === 'string')
      .map((handoff) => `${handoff.from} -> ${handoff.to}`);
    for (const duplicate of uniqueDuplicates(handoffKeys)) {
      errors.push(`${path}.handoffs: duplicate handoff ${duplicate}.`);
    }
    for (const [handoffIndex, handoff] of handoffs.entries()) {
      if (!handoff || typeof handoff !== 'object') continue;
      if (handoff.from === handoff.to && typeof handoff.from === 'string') {
        errors.push(`${path}.handoffs[${handoffIndex}]: handoff endpoints must be distinct.`);
      }
      for (const endpoint of [handoff.from, handoff.to]) {
        if (typeof endpoint === 'string' && !included.has(endpoint)) {
          errors.push(
            `${path}.handoffs[${handoffIndex}]: handoff endpoint ${endpoint} is not an included member.`,
          );
        }
      }
      if (memberNames.length === 1) {
        if (handoffs.length !== 0) {
          errors.push(`${path}.handoffs: a single-member pack must not declare handoffs.`);
        }
      } else if (memberNames.length > 1) {
        const outgoing = new Map();
        const incoming = new Map();
        for (const handoff of handoffs) {
          if (typeof handoff?.from !== 'string' || typeof handoff?.to !== 'string') continue;
          outgoing.set(handoff.from, (outgoing.get(handoff.from) ?? 0) + 1);
          incoming.set(handoff.to, (incoming.get(handoff.to) ?? 0) + 1);
        }
        if ([...outgoing.values(), ...incoming.values()].some((count) => count > 1)) {
          errors.push(`${path}.handoffs: branching or merging is not allowed.`);
        }
        const sequence = handoffs.length > 0
          ? [handoffs[0]?.from, ...handoffs.map((handoff) => handoff?.to)]
          : [];
        const continuous = handoffs.length === memberNames.length - 1
          && handoffs.every((handoff, index) => index === 0
            || handoff?.from === handoffs[index - 1]?.to)
          && sequence.every((name) => typeof name === 'string')
          && new Set(sequence).size === sequence.length
          && sequence.length === included.size
          && sequence.every((name) => included.has(name));
        if (!continuous) {
          errors.push(
            `${path}.handoffs: members must form one continuous acyclic workflow in declared order.`,
          );
        }
      }
    }
    const conflicts = Array.isArray(pack.conflicts) ? pack.conflicts : [];
    for (const duplicate of uniqueDuplicates(conflicts)) {
      errors.push(`${path}.conflicts: duplicate conflict ${duplicate}.`);
    }
    for (const conflict of conflicts) {
      if (included.has(conflict)) {
        errors.push(`${path}: declared conflict ${conflict} is also an included member.`);
      } else if (!skills.has(conflict)) {
        errors.push(`${path}.conflicts: unknown skill ${conflict}.`);
      }
    }
    for (const duplicate of uniqueDuplicates(pack.installPolicy?.requiredRuntimes ?? [])) {
      errors.push(`${path}.installPolicy.requiredRuntimes: duplicate runtime ${duplicate}.`);
    }
  }
  for (const [name, tombstone] of Object.entries(manifest.removed ?? {})) {
    if (packNames.includes(name)) errors.push(`$.removed.${name}: tombstone matches an active pack.`);
    if (tombstone?.replacement === name) {
      errors.push(`$.removed.${name}.replacement: replacement must not reference itself.`);
    } else if (tombstone?.replacement && !packNames.includes(tombstone.replacement)) {
      errors.push(
        `$.removed.${name}.replacement: replacement does not identify an active pack.`,
      );
    }
  }
  return [...new Set(errors)];
}

function definitionWithoutVersion(pack) {
  const copy = structuredClone(pack);
  delete copy.version;
  return copy;
}

export function validatePackTransitions(previous, current) {
  const errors = [];
  const previousActive = new Map((previous?.packs ?? []).map((pack) => [pack.name, pack]));
  const currentActive = new Map((current?.packs ?? []).map((pack) => [pack.name, pack]));
  const previousRemoved = previous?.removed ?? {};
  const currentRemoved = current?.removed ?? {};
  for (const [name, before] of previousActive) {
    const after = currentActive.get(name);
    if (!after) {
      const tombstone = currentRemoved[name];
      if (!tombstone) errors.push(`pack ${name}: removal requires a pack tombstone.`);
      else if (tombstone.version !== before.version) {
        errors.push(`pack ${name}: removal tombstone must preserve version ${before.version}.`);
      }
      continue;
    }
    const changed = JSON.stringify(definitionWithoutVersion(before))
      !== JSON.stringify(definitionWithoutVersion(after));
    if (changed && compareSemver(after.version, before.version) <= 0) {
      errors.push(`pack ${name}: definition changed without a strictly higher version.`);
    }
    if (!changed && compareSemver(after.version, before.version) < 0) {
      errors.push(`pack ${name}: version must not decrease.`);
    }
  }
  for (const [name, tombstone] of Object.entries(previousRemoved)) {
    if (currentActive.has(name)) {
      errors.push(`pack ${name}: removed-to-active transition is not allowed.`);
    } else if (!currentRemoved[name]) {
      errors.push(`pack ${name}: removed tombstone must be preserved.`);
    } else if (JSON.stringify(tombstone) !== JSON.stringify(currentRemoved[name])) {
      errors.push(`pack ${name}: tombstone changed.`);
    }
  }
  for (const name of Object.keys(currentRemoved)) {
    if (!Object.hasOwn(previousRemoved, name) && !previousActive.has(name)) {
      errors.push(
        `pack ${name}: new tombstone requires an active pack in the immediate previous registry.`,
      );
    }
  }
  return errors;
}
