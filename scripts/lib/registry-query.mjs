const FILTER_KEYS = new Set([
  'category',
  'input',
  'output',
  'risk',
  'runtime',
  'runtimeStatus',
  'tags',
]);
const RISK_LEVELS = new Set(['low', 'medium', 'high']);
const RUNTIMES = new Set(['claude-code', 'github-copilot', 'openai-codex']);
const RUNTIME_STATUSES = new Set(['compatible', 'conditional', 'unsupported', 'untested']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function queryRegistry(registry, filters = {}) {
  for (const key of Object.keys(filters)) {
    if (!FILTER_KEYS.has(key)) throw new Error(`Unknown registry filter: ${key}.`);
  }
  if (filters.runtimeStatus && !filters.runtime) {
    throw new Error('runtimeStatus requires a runtime filter.');
  }
  if (filters.risk && !RISK_LEVELS.has(filters.risk)) {
    throw new Error(`Unknown risk level: ${filters.risk}.`);
  }
  if (filters.runtime && !RUNTIMES.has(filters.runtime)) {
    throw new Error(`Unknown runtime: ${filters.runtime}.`);
  }
  if (filters.runtimeStatus && !RUNTIME_STATUSES.has(filters.runtimeStatus)) {
    throw new Error(`Unknown runtime status: ${filters.runtimeStatus}.`);
  }

  const tags = Array.isArray(filters.tags)
    ? filters.tags
    : filters.tags
      ? [filters.tags]
      : [];
  for (const [key, value] of [
    ['category', filters.category],
    ['input', filters.input],
    ['output', filters.output],
    ...tags.map((tag) => ['tag', tag]),
  ]) {
    if (value && !SLUG_PATTERN.test(value)) {
      throw new Error(`${key} must be a lowercase slug.`);
    }
  }

  return (registry.skills ?? []).filter((skill) => {
    const discovery = skill.discovery;
    if (!discovery) return false;
    if (filters.category && discovery.category !== filters.category) return false;
    if (filters.input && !discovery.inputs.some((item) => item.type === filters.input)) return false;
    if (filters.output && !discovery.outputs.some((item) => item.type === filters.output)) return false;
    if (filters.risk && discovery.risk.level !== filters.risk) return false;
    if (tags.some((tag) => !discovery.tags.includes(tag))) return false;
    if (filters.runtime) {
      const runtime = discovery.runtimeCompatibility
        .find((item) => item.runtime === filters.runtime);
      if (!runtime || (filters.runtimeStatus && runtime.status !== filters.runtimeStatus)) return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}
