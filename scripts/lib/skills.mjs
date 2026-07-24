// Skill discovery and content scanning helpers used by the validator and the
// registry generator.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Unsafe Unicode code points: zero-width characters, bidirectional formatting
// controls, isolates, and the BOM. Reported by code point, never reproduced.
export const UNSAFE_CODE_POINTS = new Map([
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x2060, 'WORD JOINER'],
  [0x2063, 'INVISIBLE SEPARATOR'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE / BOM'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
]);

// Returns a direct child directory list of `skills/` that contain a SKILL.md.
export function discoverSkills(skillsRoot) {
  if (!existsSync(skillsRoot)) return [];
  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(skillsRoot, entry.name);
    if (existsSync(resolve(dir, 'SKILL.md'))) {
      skills.push({ name: entry.name, dir });
    }
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// Finds unsafe Unicode code points in `text`, returning {codePoint, name, line}.
export function findUnsafeUnicode(text) {
  const findings = [];
  let line = 1;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ch === '\n') { line += 1; continue; }
    if (UNSAFE_CODE_POINTS.has(cp)) {
      findings.push({ codePoint: cp, name: UNSAFE_CODE_POINTS.get(cp), line });
    }
  }
  return findings;
}

// Extracts inline markdown link targets `[text](target)` and autolinks
// `<target>` from markdown, returning { target, line } entries. Fragments and
// query strings are stripped by the caller.
export function extractLinkTargets(markdown) {
  const targets = [];
  const lines = markdown.split('\n');
  const inline = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  lines.forEach((text, index) => {
    let match;
    while ((match = inline.exec(text)) !== null) {
      targets.push({ target: match[1], line: index + 1 });
    }
  });
  return targets;
}

const SECRET_PATTERNS = [
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[0-9A-Za-z]{36}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: 'generic-secret-assignment', re: /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9+/_-]{20,}["']?/i },
];

// Scans text for likely secrets, returning { id, line } without the secret.
export function findSecrets(text) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(line)) {
        findings.push({ id: pattern.id, line: index + 1 });
      }
    }
  });
  return findings;
}

// Conservative token approximation: ~4 characters per token.
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function isProbablyText(path) {
  try {
    const size = statSync(path).size;
    if (size > 2 * 1024 * 1024) return false;
  } catch {
    return false;
  }
  return true;
}
