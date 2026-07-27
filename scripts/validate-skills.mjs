#!/usr/bin/env node

// Validates skills/*/SKILL.md against the Agent Skills contract. Emits stable
// rule IDs with error/warning severity in text or JSON form. Exit 0 when no
// errors, 1 otherwise. Never executes skill content.

import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseFrontmatter, MissingFrontmatterError } from './lib/frontmatter.mjs';
import { usesFirstOrSecondPerson } from './lib/description-language.mjs';
import { Diagnostics, formatJson, formatText } from './lib/diagnostics.mjs';
import {
  discoverSkills,
  extractLinkTargets,
  findSecrets,
  findUnsafeUnicode,
  estimateTokens,
  isProbablyText,
} from './lib/skills.mjs';
import { assertNoSymlinks, walkFiles } from './lib/paths.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORTABLE_KEYS = new Set([
  'name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools',
]);
const REPOSITORY_KEYS = new Set([
  ...PORTABLE_KEYS,
  'argument-hint', 'user-invocable', 'disable-model-invocation', 'context',
]);
const STRING_FIELDS = new Set([
  'name', 'description', 'license', 'compatibility', 'allowed-tools', 'argument-hint', 'context',
]);
const BOOLEAN_FIELDS = new Set(['user-invocable', 'disable-model-invocation']);

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const TRIGGER_PATTERN = /\b(use when|use for|use to|use before|use after|use during|applies when|applies to|runs when|invoked when|invoke when|activate when|handles?\b)/i;

function stripLinkTarget(target) {
  let value = target.trim();
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf('?');
  if (query >= 0) value = value.slice(0, query);
  return value;
}

function isExternalLink(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

function isAbsoluteLocal(target) {
  return target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\');
}

function containsAngleBrackets(value) {
  return value.includes('<') || value.includes('>');
}

// Validates a single skill directory, appending diagnostics.
function validateSkill(skill, options, diagnostics, seenNames) {
  const { name, dir } = skill;
  const skillFile = resolve(dir, 'SKILL.md');
  const rel = (abs) => relative(REPOSITORY_ROOT, abs).split(sep).join('/');
  const skillFileRel = rel(skillFile);

  // Discovery / file structure.
  let skillStat;
  try {
    skillStat = lstatSync(skillFile);
  } catch {
    diagnostics.error('structure/skill-md-missing', skillFileRel, 'SKILL.md is missing or unreadable.');
    return;
  }
  if (skillStat.isSymbolicLink() || !skillStat.isFile()) {
    diagnostics.error('structure/skill-md-not-file', skillFileRel, 'SKILL.md must be a regular file, not a symlink or special file.');
    return;
  }

  let content;
  try {
    content = readFileSync(skillFile, 'utf8');
  } catch {
    diagnostics.error('structure/skill-md-missing', skillFileRel, 'SKILL.md could not be read as UTF-8 text.');
    return;
  }

  // Frontmatter parsing.
  let parsed;
  try {
    parsed = parseFrontmatter(content);
  } catch (error) {
    const rule = error instanceof MissingFrontmatterError
      ? 'frontmatter/missing'
      : 'frontmatter/parse-error';
    diagnostics.error(rule, skillFileRel, error.message, error.line);
    return;
  }

  const { data, body, keyLines } = parsed;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    diagnostics.error('frontmatter/not-mapping', skillFileRel, 'Frontmatter must be a mapping of keys to values.');
    return;
  }

  const allowedKeys = options.profile === 'portable' ? PORTABLE_KEYS : REPOSITORY_KEYS;
  for (const key of Object.keys(data)) {
    if (!allowedKeys.has(key)) {
      const hostOnly = REPOSITORY_KEYS.has(key) && !PORTABLE_KEYS.has(key);
      const message = hostOnly
        ? `Host-specific frontmatter key "${key}" is not allowed in the portable profile.`
        : `Unknown frontmatter key "${key}".`;
      diagnostics.error('frontmatter/unknown-key', skillFileRel, message, keyLines[key]);
    }
  }

  // Field type checks for allowed scalar fields.
  for (const key of Object.keys(data)) {
    if (STRING_FIELDS.has(key) && typeof data[key] !== 'string') {
      diagnostics.error('frontmatter/field-type', skillFileRel, `Frontmatter key "${key}" must be a string.`, keyLines[key]);
    }
    if (BOOLEAN_FIELDS.has(key) && typeof data[key] !== 'boolean') {
      diagnostics.error('frontmatter/field-type', skillFileRel, `Frontmatter key "${key}" must be a boolean.`, keyLines[key]);
    }
  }

  // Required: name.
  if (!('name' in data) || data.name === null) {
    diagnostics.error('frontmatter/name-required', skillFileRel, 'Frontmatter "name" is required.');
  } else if (typeof data.name === 'string') {
    const value = data.name.trim();
    if (value.length < 1 || value.length > 64 || !NAME_PATTERN.test(value)) {
      diagnostics.error('frontmatter/name-pattern', skillFileRel, 'name must match ^[a-z0-9]+(?:-[a-z0-9]+)*$ and be 1-64 characters.', keyLines.name);
    }
    if (/anthropic|claude/i.test(value)) {
      diagnostics.error('frontmatter/name-reserved', skillFileRel, 'name must not contain the reserved words "anthropic" or "claude".', keyLines.name);
    }
    if (value !== name) {
      diagnostics.error('frontmatter/name-directory-match', skillFileRel, `Frontmatter name must match directory name "${name}".`, keyLines.name);
    }
  }

  // Required: description.
  if (!('description' in data) || data.description === null) {
    diagnostics.error('frontmatter/description-required', skillFileRel, 'Frontmatter "description" is required.');
  } else if (typeof data.description === 'string') {
    const value = data.description;
    if (value.trim().length < 1 || value.length > 1024) {
      diagnostics.error('frontmatter/description-length', skillFileRel, 'description must be 1-1024 characters after trimming.', keyLines.description);
    }
    if (containsAngleBrackets(value)) {
      diagnostics.error('frontmatter/description-angle-brackets', skillFileRel, 'description must not contain "<" or ">".', keyLines.description);
    }
    // SHOULD: quality warnings.
    if (value.trim().length < 40) {
      diagnostics.warning('description/too-short', skillFileRel, 'description is shorter than 40 characters; add what the skill does and when to use it.', keyLines.description);
    }
    if (!TRIGGER_PATTERN.test(value)) {
      diagnostics.warning('description/missing-trigger', skillFileRel, 'description should state when to use the skill (e.g. "Use when ...").', keyLines.description);
    }
    if (usesFirstOrSecondPerson(value)) {
      diagnostics.warning('description/person', skillFileRel, 'description should be written in third person, not first or second person.', keyLines.description);
    }
  }

  // metadata mapping.
  if ('metadata' in data && data.metadata !== null) {
    const metadata = data.metadata;
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
      diagnostics.error('frontmatter/metadata-type', skillFileRel, 'metadata must be a mapping of string values.', keyLines.metadata);
    } else {
      for (const [key, value] of Object.entries(metadata)) {
        if (typeof value !== 'string') {
          diagnostics.error('frontmatter/metadata-value-type', skillFileRel, `metadata.${key} must be a string.`, keyLines.metadata);
        }
      }
      if (typeof metadata.version === 'string' && !SEMVER_PATTERN.test(metadata.version)) {
        diagnostics.error('frontmatter/metadata-version-semver', skillFileRel, 'metadata.version must be a semantic version (e.g. "1.0.0").', keyLines.metadata);
      }
    }
  }

  // SHOULD: license present.
  if (!('license' in data) || data.license === null || data.license === '') {
    diagnostics.warning('license/missing', skillFileRel, 'license is recommended for every distributable skill.');
  }

  // Body length / token budget.
  const bodyLineCount = body.split('\n').length;
  if (bodyLineCount > 500) {
    diagnostics.warning('body/too-long', skillFileRel, `SKILL.md body is ${bodyLineCount} lines (recommended under 500).`);
  }
  if (estimateTokens(body) > 5000) {
    diagnostics.warning('body/too-many-tokens', skillFileRel, 'SKILL.md body is roughly over 5000 tokens; move detail into references/.');
  }

  // Duplicate names across skills.
  if (typeof data.name === 'string') {
    if (seenNames.has(data.name)) {
      diagnostics.error('skill/duplicate-name', skillFileRel, `Duplicate skill name "${data.name}" also defined in ${seenNames.get(data.name)}.`, keyLines.name);
    } else {
      seenNames.set(data.name, skillFileRel);
    }
  }

  // Relative link resolution and path safety.
  const skillDirResolved = resolve(dir);
  for (const { target, line } of extractLinkTargets(body)) {
    if (isExternalLink(target)) continue;
    const stripped = stripLinkTarget(target);
    if (stripped === '') continue;
    if (isAbsoluteLocal(stripped)) {
      diagnostics.error('path/absolute', skillFileRel, `Local link "${target}" must be a relative path inside the skill.`, line);
      continue;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(stripped);
    } catch {
      decoded = stripped;
    }
    let resolvedTarget;
    try {
      resolvedTarget = assertNoSymlinks(skillDirResolved, decoded);
    } catch {
      diagnostics.error('links/escapes-skill-dir', skillFileRel, `Local link "${target}" escapes the skill directory or passes through a symlink.`, line);
      continue;
    }
    if (!existsSync(resolvedTarget)) {
      diagnostics.error('links/broken', skillFileRel, `Local link "${target}" does not resolve to an existing file.`, line);
    }
  }

  // Absolute paths in SKILL.md text (home dirs, POSIX roots) outside code hints.
  const absolutePathPattern = new RegExp(`(?:^|\\s)(?:${homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|/(?:Users|home|etc|var|usr)/)`);
  if (absolutePathPattern.test(content)) {
    diagnostics.warning('path/hardcoded-absolute', skillFileRel, 'SKILL.md appears to contain a hard-coded absolute or home-directory path.');
  }

  // references/ depth.
  const referencesDir = resolve(dir, 'references');
  if (existsSync(referencesDir) && statSync(referencesDir).isDirectory()) {
    let referenceFiles = [];
    try {
      referenceFiles = walkFiles(referencesDir);
    } catch {
      referenceFiles = [];
    }
    for (const refRel of referenceFiles) {
      if (refRel.split('/').length > 1) {
        diagnostics.warning('references/too-deep', rel(resolve(referencesDir, refRel)), 'references/ should be at most one level deep.');
        break;
      }
    }
  }

  // Whole-tree scans: unsafe Unicode (error), secrets (warning), script bits.
  let treeFiles = [];
  try {
    treeFiles = walkFiles(dir);
  } catch (error) {
    diagnostics.error('symlink/unsafe', skillFileRel, error.message);
    treeFiles = [];
  }
  for (const treeRel of treeFiles) {
    const abs = resolve(dir, treeRel);
    const fileRel = rel(abs);
    if (!isProbablyText(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const finding of findUnsafeUnicode(text)) {
      diagnostics.error('unicode/unsafe', fileRel, `Unsafe Unicode ${finding.name} (U+${finding.codePoint.toString(16).toUpperCase().padStart(4, '0')}).`, finding.line);
    }
    for (const finding of findSecrets(text)) {
      diagnostics.warning('secrets/possible', fileRel, `Possible ${finding.id} detected; verify before committing.`, finding.line);
    }
    // Executable-bit expectations for shell scripts.
    if (treeRel.startsWith('scripts/') && treeRel.endsWith('.sh')) {
      try {
        const mode = statSync(abs).mode;
        if ((mode & 0o111) === 0) {
          diagnostics.warning('scripts/not-executable', fileRel, 'Shell script under scripts/ is missing an executable bit.');
        }
      } catch {
        // ignore stat failures
      }
    }
  }
}

function getChangedSkillNames() {
  try {
    const output = execFileSync('git', ['-C', REPOSITORY_ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
    const names = new Set();
    for (const line of output.split('\n')) {
      const file = line.slice(3).trim();
      if (!file) continue;
      const match = file.match(/^skills\/([^/]+)\//);
      if (match) names.add(match[1]);
    }
    return names;
  } catch {
    return null;
  }
}

export function validate({ skillsRoot = resolve(REPOSITORY_ROOT, 'skills'), profile = 'repository', changed = false } = {}) {
  const diagnostics = new Diagnostics();
  const seenNames = new Map();
  let skills = discoverSkills(skillsRoot);
  if (changed) {
    const changedNames = getChangedSkillNames();
    if (changedNames) {
      skills = skills.filter((skill) => changedNames.has(skill.name));
    }
  }
  for (const skill of skills) {
    validateSkill(skill, { profile }, diagnostics, seenNames);
  }
  return diagnostics;
}

function parseArguments(args) {
  const options = { format: 'text', profile: 'repository', changed: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--format') {
      options.format = args[i + 1];
      i += 1;
    } else if (arg === '--profile') {
      options.profile = args[i + 1];
      i += 1;
    } else if (arg === '--changed') {
      options.changed = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['text', 'json'].includes(options.format)) {
    throw new Error(`--format must be "text" or "json", got "${options.format}".`);
  }
  if (!['portable', 'repository'].includes(options.profile)) {
    throw new Error(`--profile must be "portable" or "repository", got "${options.profile}".`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const diagnostics = validate({ profile: options.profile, changed: options.changed });
  const output = options.format === 'json' ? formatJson(diagnostics) : formatText(diagnostics);
  console.log(output);
  process.exitCode = diagnostics.hasErrors() ? 1 : 0;
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
