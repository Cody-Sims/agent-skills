// Strict, dependency-free YAML frontmatter parser for SKILL.md.
//
// It intentionally supports only the small subset the Agent Skills schema
// allows: a leading `---` delimited block containing top-level scalar values
// (strings, booleans, numbers, null) and a one-level nested mapping (used for
// `metadata`). Anything it cannot parse unambiguously is rejected with a
// FrontmatterError rather than silently guessed.

export class FrontmatterError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'FrontmatterError';
    this.line = line;
  }
}

// Raised when a file has no `---` frontmatter block at all. Callers may treat
// this differently from a malformed block.
export class MissingFrontmatterError extends FrontmatterError {
  constructor(message, line) {
    super(message, line);
    this.name = 'MissingFrontmatterError';
  }
}

const BOOL_TRUE = new Set(['true', 'True', 'TRUE']);
const BOOL_FALSE = new Set(['false', 'False', 'FALSE']);
const NULLS = new Set(['null', 'Null', 'NULL', '~', '']);
const RESERVED_INDICATORS = ['[', '{', '|', '>', '&', '*', '!', '`', '%', '@'];

function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

function stripCr(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function parseDoubleQuoted(raw, line) {
  let result = '';
  let i = 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === undefined) throw new FrontmatterError('Unterminated escape in double-quoted string.', line);
      const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '0': '\0', '/': '/' };
      if (!(next in map)) throw new FrontmatterError(`Unsupported escape sequence \\${next}.`, line);
      result += map[next];
      i += 2;
      continue;
    }
    if (ch === '"') {
      const rest = raw.slice(i + 1).trim();
      if (rest !== '' && !rest.startsWith('#')) {
        throw new FrontmatterError('Unexpected content after double-quoted string.', line);
      }
      return result;
    }
    result += ch;
    i += 1;
  }
  throw new FrontmatterError('Unterminated double-quoted string.', line);
}

function parseSingleQuoted(raw, line) {
  let result = '';
  let i = 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "'") {
      if (raw[i + 1] === "'") {
        result += "'";
        i += 2;
        continue;
      }
      const rest = raw.slice(i + 1).trim();
      if (rest !== '' && !rest.startsWith('#')) {
        throw new FrontmatterError('Unexpected content after single-quoted string.', line);
      }
      return result;
    }
    result += ch;
    i += 1;
  }
  throw new FrontmatterError('Unterminated single-quoted string.', line);
}

function parseScalar(rawValue, line) {
  const value = rawValue.trim();
  if (value.startsWith('"')) return parseDoubleQuoted(value, line);
  if (value.startsWith("'")) return parseSingleQuoted(value, line);
  if (RESERVED_INDICATORS.includes(value[0])) {
    throw new FrontmatterError(`Unsupported YAML construct starting with "${value[0]}".`, line);
  }
  if (BOOL_TRUE.has(value)) return true;
  if (BOOL_FALSE.has(value)) return false;
  if (NULLS.has(value)) return null;
  if (/^[-+]?[0-9]+$/.test(value)) return Number(value);
  if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(value)) return Number(value);
  return value;
}

const KEY_LINE = /^([ \t]*)([^:\s][^:]*?):(?:[ \t]+(.*))?$/;

function parseKeyLine(line, lineNo) {
  const trimmed = line.trim();
  if (trimmed.startsWith('- ') || trimmed === '-') {
    throw new FrontmatterError('YAML sequences are not supported in frontmatter.', lineNo);
  }
  const match = line.match(KEY_LINE);
  if (!match) {
    throw new FrontmatterError('Expected a "key: value" mapping entry.', lineNo);
  }
  const [, indent, key, rawValue] = match;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key.trim())) {
    throw new FrontmatterError(`Invalid or non-string frontmatter key "${key.trim()}".`, lineNo);
  }
  const hasValue = rawValue !== undefined && rawValue.trim() !== '';
  return { indent: indent.length, key: key.trim(), rawValue, hasValue };
}

// Parses the whole file. Returns { data, body, keyLines, endLine }.
// - data: parsed frontmatter mapping
// - body: markdown content after the closing delimiter
// - keyLines: 1-based file line number for each top-level key
// - endLine: 1-based file line number of the closing `---`
export function parseFrontmatter(content) {
  if (content.charCodeAt(0) === 0xfeff) {
    throw new FrontmatterError('UTF-8 BOM is not allowed at the start of SKILL.md.', 1);
  }
  const rawLines = content.split('\n').map(stripCr);
  if (rawLines[0] !== '---') {
    throw new MissingFrontmatterError('SKILL.md must begin with a "---" frontmatter delimiter.', 1);
  }
  let closingIndex = -1;
  for (let i = 1; i < rawLines.length; i += 1) {
    if (rawLines[i] === '---' || rawLines[i] === '...') {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    throw new FrontmatterError('Unterminated frontmatter: missing closing "---" delimiter.', 1);
  }

  const fmLines = rawLines.slice(1, closingIndex);
  const data = {};
  const keyLines = {};
  const seen = new Set();

  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    const fileLine = i + 2;
    if (isBlankOrComment(line)) { i += 1; continue; }
    if (/^[ \t]/.test(line)) {
      throw new FrontmatterError('Unexpected indentation at the top level.', fileLine);
    }
    const entry = parseKeyLine(line, fileLine);
    if (seen.has(entry.key)) {
      throw new FrontmatterError(`Duplicate frontmatter key "${entry.key}".`, fileLine);
    }
    seen.add(entry.key);
    keyLines[entry.key] = fileLine;

    if (entry.hasValue) {
      data[entry.key] = parseScalar(entry.rawValue, fileLine);
      i += 1;
      continue;
    }

    // No inline value: either a nested mapping or an explicit null.
    let j = i + 1;
    while (j < fmLines.length && isBlankOrComment(fmLines[j])) j += 1;
    if (j >= fmLines.length || !/^[ \t]/.test(fmLines[j])) {
      data[entry.key] = null;
      i += 1;
      continue;
    }

    const nested = {};
    const nestedSeen = new Set();
    const baseIndentMatch = fmLines[j].match(/^([ \t]+)/);
    const baseIndent = baseIndentMatch[1].length;
    let k = i + 1;
    while (k < fmLines.length) {
      const nestedLine = fmLines[k];
      const nestedFileLine = k + 2;
      if (isBlankOrComment(nestedLine)) { k += 1; continue; }
      const indentMatch = nestedLine.match(/^([ \t]*)/);
      const indent = indentMatch[1].length;
      if (indent === 0) break;
      if (indent !== baseIndent) {
        throw new FrontmatterError('Inconsistent or nested-too-deep indentation in mapping.', nestedFileLine);
      }
      const nestedEntry = parseKeyLine(nestedLine, nestedFileLine);
      if (!nestedEntry.hasValue) {
        throw new FrontmatterError('Nested mappings deeper than one level are not supported.', nestedFileLine);
      }
      if (nestedSeen.has(nestedEntry.key)) {
        throw new FrontmatterError(`Duplicate key "${nestedEntry.key}" in "${entry.key}" mapping.`, nestedFileLine);
      }
      nestedSeen.add(nestedEntry.key);
      nested[nestedEntry.key] = parseScalar(nestedEntry.rawValue, nestedFileLine);
      k += 1;
    }
    data[entry.key] = nested;
    i = k;
  }

  const body = rawLines.slice(closingIndex + 1).join('\n');
  return { data, body, keyLines, endLine: closingIndex + 1 };
}
