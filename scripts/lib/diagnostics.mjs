// Diagnostic collection and formatting. Diagnostics have a stable rule ID, a
// severity, the offending file, an optional line, and a human message, matching
// the machine-readable shape documented in the tooling research (section 3).

export class Diagnostics {
  constructor() {
    this.items = [];
  }

  add(severity, rule, file, message, line) {
    const diagnostic = { rule, severity, file, message };
    if (typeof line === 'number') diagnostic.line = line;
    this.items.push(diagnostic);
    return diagnostic;
  }

  error(rule, file, message, line) {
    return this.add('error', rule, file, message, line);
  }

  warning(rule, file, message, line) {
    return this.add('warning', rule, file, message, line);
  }

  get errors() {
    return this.items.filter((item) => item.severity === 'error');
  }

  get warnings() {
    return this.items.filter((item) => item.severity === 'warning');
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  toJSON() {
    return {
      version: 1,
      ok: !this.hasErrors(),
      diagnostics: this.items.slice().sort(compareDiagnostics),
    };
  }
}

function compareDiagnostics(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  const aLine = a.line ?? 0;
  const bLine = b.line ?? 0;
  if (aLine !== bLine) return aLine - bLine;
  return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
}

export function formatJson(diagnostics) {
  return JSON.stringify(diagnostics.toJSON(), null, 2);
}

export function formatText(diagnostics) {
  const sorted = diagnostics.items.slice().sort(compareDiagnostics);
  const lines = [];
  for (const item of sorted) {
    const location = typeof item.line === 'number' ? `${item.file}:${item.line}` : item.file;
    const badge = item.severity === 'error' ? 'error' : 'warning';
    lines.push(`${badge} ${item.rule} ${location}: ${item.message}`);
  }
  const errorCount = diagnostics.errors.length;
  const warningCount = diagnostics.warnings.length;
  lines.push('');
  lines.push(`${errorCount} error(s), ${warningCount} warning(s).`);
  return lines.join('\n');
}
