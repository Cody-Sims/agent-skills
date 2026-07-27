import { validateAgainstSchema } from './jsonschema.mjs';

const SUPPORTED_RUNTIMES = ['claude-code', 'github-copilot', 'openai-codex'];

function requireUnique(values, path, errors) {
  const unique = new Set(values);
  if (unique.size !== values.length) errors.push(`${path}: values must be unique.`);
}

export function normalizeDiscovery(record) {
  return {
    ...record,
    tags: [...record.tags].sort(),
    inputs: [...record.inputs].sort((a, b) => a.type.localeCompare(b.type)),
    outputs: [...record.outputs].sort((a, b) => a.type.localeCompare(b.type)),
    risk: {
      ...record.risk,
      factors: [...record.risk.factors].sort(),
    },
    runtimeCompatibility: [...record.runtimeCompatibility]
      .sort((a, b) => a.runtime.localeCompare(b.runtime)),
    relatedSkills: [...record.relatedSkills].sort(),
    conflictingSkills: [...record.conflictingSkills].sort(),
  };
}

export function validateDiscoveryManifest(schema, manifest, skillNames) {
  const errors = validateAgainstSchema(schema, manifest);
  if (!manifest?.skills || typeof manifest.skills !== 'object') return errors;

  const known = new Set(skillNames);
  for (const name of skillNames) {
    if (!Object.hasOwn(manifest.skills, name)) {
      errors.push(`$.skills: missing discovery metadata for ${name}.`);
    }
  }
  for (const [name, record] of Object.entries(manifest.skills)) {
    if (!known.has(name)) {
      errors.push(`$.skills.${name}: discovery metadata references unknown skill.`);
      continue;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const listFields = ['tags', 'relatedSkills', 'conflictingSkills'];
    for (const field of listFields) {
      if (Array.isArray(record[field])) {
        requireUnique(record[field], `$.skills.${name}.${field}`, errors);
      }
    }
    if (Array.isArray(record.risk?.factors)) {
      requireUnique(record.risk.factors, `$.skills.${name}.risk.factors`, errors);
    }
    if (Array.isArray(record.examplePrompts)) {
      requireUnique(record.examplePrompts, `$.skills.${name}.examplePrompts`, errors);
    }
    for (const field of ['relatedSkills', 'conflictingSkills']) {
      for (const target of Array.isArray(record[field]) ? record[field] : []) {
        if (target === name) errors.push(`$.skills.${name}.${field}: must not reference itself.`);
        if (!known.has(target)) errors.push(`$.skills.${name}.${field}: unknown skill ${target}.`);
      }
    }
    const relatedSkills = Array.isArray(record.relatedSkills) ? record.relatedSkills : [];
    const conflictingSkills = Array.isArray(record.conflictingSkills)
      ? record.conflictingSkills
      : [];
    const overlap = relatedSkills.filter((target) => conflictingSkills.includes(target));
    if (overlap.length > 0) {
      errors.push(`$.skills.${name}: related and conflicting skills overlap: ${overlap.join(', ')}.`);
    }
    for (const field of ['inputs', 'outputs']) {
      const types = Array.isArray(record[field])
        ? record[field]
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => entry.type)
        : [];
      requireUnique(types, `$.skills.${name}.${field}`, errors);
    }
    const runtimeCompatibility = Array.isArray(record.runtimeCompatibility)
      ? record.runtimeCompatibility
      : [];
    const runtimes = runtimeCompatibility
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => entry.runtime);
    for (const [index, runtime] of runtimeCompatibility.entries()) {
      if (runtime?.status === 'conditional'
        && (typeof runtime.notes !== 'string' || runtime.notes.trim() === '')) {
        errors.push(
          `$.skills.${name}.runtimeCompatibility[${index}].notes: conditional status requires notes.`,
        );
      }
    }
    requireUnique(runtimes, `$.skills.${name}.runtimeCompatibility`, errors);
    for (const runtime of SUPPORTED_RUNTIMES) {
      if (!runtimes.includes(runtime)) {
        errors.push(`$.skills.${name}.runtimeCompatibility: missing runtime ${runtime}.`);
      }
    }
  }
  return errors;
}

export function placeholderDiscovery(name) {
  return {
    category: 'uncategorized',
    tags: ['uncategorized'],
    inputs: [{ type: 'request', description: 'A user request.' }],
    outputs: [{ type: 'result', description: 'A task result.' }],
    risk: { level: 'low', factors: [] },
    runtimeCompatibility: [
      { runtime: 'claude-code', status: 'untested', notes: null },
      { runtime: 'github-copilot', status: 'untested', notes: null },
      { runtime: 'openai-codex', status: 'untested', notes: null },
    ],
    relatedSkills: [],
    conflictingSkills: [],
    examplePrompts: [`Use ${name} for this task.`],
  };
}
