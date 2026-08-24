#!/usr/bin/env node

import { lstatSync, readdirSync } from 'node:fs';
import { parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const VALUE_OPTIONS = new Set(['--root', '--max-depth', '--max-entries']);
const FLAG_OPTIONS = new Set(['--include-hidden', '--help']);
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES = 2000;
const MAX_DEPTH_LIMIT = 20;
const MAX_ENTRIES_LIMIT = 100000;

export const IGNORED_DIRECTORIES = Object.freeze([
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.svn',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'tmp',
  'vendor',
]);

const IGNORED_DIRECTORY_SET = new Set(IGNORED_DIRECTORIES);
const DISCOVERY_HIDDEN_ENTRIES = new Set(['.github', '.shadow']);

export const HELP = `Usage: node scripts/inventory.mjs [options]

Produces a deterministic JSON inventory of repository paths without reading file
contents, following symlinks, writing files, installing packages, or using the
network.

Options:
  --root <path>         Root directory to inventory (default: current directory)
  --max-depth <0-20>    Maximum emitted path depth (default: 4)
  --max-entries <n>     Maximum emitted entries, 1-100000 (default: 2000)
  --include-hidden      Include hidden entries except ignored directories
  --help                Print this help and exit

Exit codes:
  0  Inventory or help completed successfully
  1  Invalid command-line arguments
  2  Filesystem, root, or traversal safety error
`;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export class InventoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InventoryError';
  }
}

function parseInteger(value, option, minimum, maximum) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value ?? '')) {
    throw new UsageError(`${option} must be an integer from ${minimum} to ${maximum}.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new UsageError(`${option} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

export function parseArguments(args, { cwd = process.cwd() } = {}) {
  const values = new Map();
  const flags = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!VALUE_OPTIONS.has(argument) && !FLAG_OPTIONS.has(argument)) {
      throw new UsageError(`Unknown argument: ${argument}`);
    }
    if (values.has(argument) || flags.has(argument)) {
      throw new UsageError(`Duplicate argument: ${argument}`);
    }
    if (argument === '--help') {
      if (args.length !== 1) {
        throw new UsageError('--help cannot be combined with other arguments.');
      }
      return { help: true };
    }
    if (VALUE_OPTIONS.has(argument)) {
      const value = args[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new UsageError(`Missing value for ${argument}.`);
      }
      values.set(argument, value);
      index += 1;
    } else {
      flags.add(argument);
    }
  }

  return {
    root: resolve(cwd, values.get('--root') ?? '.'),
    maxDepth: parseInteger(
      values.get('--max-depth') ?? String(DEFAULT_MAX_DEPTH),
      '--max-depth',
      0,
      MAX_DEPTH_LIMIT,
    ),
    maxEntries: parseInteger(
      values.get('--max-entries') ?? String(DEFAULT_MAX_ENTRIES),
      '--max-entries',
      1,
      MAX_ENTRIES_LIMIT,
    ),
    includeHidden: flags.has('--include-hidden'),
  };
}

function assertSafeRoot(root) {
  const resolvedRoot = resolve(root);
  const parsed = parse(resolvedRoot);
  let current = parsed.root;

  try {
    for (const part of relative(parsed.root, resolvedRoot).split(sep).filter(Boolean)) {
      current = resolve(current, part);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new InventoryError(`Refusing a symlink in the root path: ${current}`);
      }
    }
    if (!lstatSync(resolvedRoot).isDirectory()) {
      throw new InventoryError(`Root is not a directory: ${resolvedRoot}`);
    }
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError(`Cannot access root ${resolvedRoot}: ${error.message}`);
  }

  return resolvedRoot;
}

function toPosixPath(parts) {
  return parts.join('/');
}

function shouldHide(name, includeHidden) {
  return !includeHidden && name.startsWith('.') && !DISCOVERY_HIDDEN_ENTRIES.has(name);
}

export function inventoryRepository(options) {
  const root = assertSafeRoot(options.root);
  const entries = [];
  const summary = {
    directories: 0,
    files: 0,
    symbolicLinks: 0,
    other: 0,
    ignoredDirectories: 0,
    hiddenEntries: 0,
  };
  let truncated = false;
  let depthLimited = false;

  const addEntry = (entry) => {
    if (entries.length >= options.maxEntries) {
      truncated = true;
      return false;
    }
    entries.push(entry);
    if (entry.type === 'directory') summary.directories += 1;
    else if (entry.type === 'file') summary.files += 1;
    else if (entry.type === 'symbolic-link') summary.symbolicLinks += 1;
    else summary.other += 1;
    return true;
  };

  const walk = (directory, parts) => {
    if (truncated) return;
    let directoryEntries;
    try {
      directoryEntries = readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    } catch (error) {
      throw new InventoryError(`Cannot read ${toPosixPath(parts) || '.'}: ${error.message}`);
    }

    for (const entry of directoryEntries) {
      if (truncated) return;
      if (entry.isDirectory() && IGNORED_DIRECTORY_SET.has(entry.name)) {
        summary.ignoredDirectories += 1;
        continue;
      }
      if (shouldHide(entry.name, options.includeHidden)) {
        summary.hiddenEntries += 1;
        continue;
      }

      const nextParts = [...parts, entry.name];
      const path = toPosixPath(nextParts);
      const depth = nextParts.length;
      const absolutePath = resolve(directory, entry.name);
      let stat;
      try {
        stat = lstatSync(absolutePath);
      } catch (error) {
        throw new InventoryError(`Cannot inspect ${path}: ${error.message}`);
      }

      if (stat.isSymbolicLink()) {
        addEntry({ path, type: 'symbolic-link', depth });
        continue;
      }
      if (stat.isDirectory()) {
        if (!addEntry({ path, type: 'directory', depth })) return;
        if (depth < options.maxDepth) walk(absolutePath, nextParts);
        else if (depth === options.maxDepth) depthLimited = true;
        continue;
      }
      if (stat.isFile()) {
        if (!addEntry({ path, type: 'file', depth })) return;
        continue;
      }
      if (!addEntry({ path, type: 'other', depth })) return;
    }
  };

  if (options.maxDepth > 0) {
    walk(root, []);
  } else {
    let rootEntries;
    try {
      rootEntries = readdirSync(root, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    } catch (error) {
      throw new InventoryError(`Cannot read .: ${error.message}`);
    }

    for (const entry of rootEntries) {
      if (entry.isDirectory() && IGNORED_DIRECTORY_SET.has(entry.name)) {
        summary.ignoredDirectories += 1;
      } else if (shouldHide(entry.name, options.includeHidden)) {
        summary.hiddenEntries += 1;
      } else {
        depthLimited = true;
      }
    }
  }

  return {
    schemaVersion: 1,
    generator: 'shadow-observe-inventory',
    root: '.',
    options: {
      maxDepth: options.maxDepth,
      maxEntries: options.maxEntries,
      includeHidden: options.includeHidden,
    },
    ignoredDirectories: [...IGNORED_DIRECTORIES],
    truncated,
    depthLimited,
    entries,
    summary: {
      ...summary,
      emittedEntries: entries.length,
    },
  };
}

export function runCli(args = process.argv.slice(2), io = console) {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    io.error(`error: ${error.message}`);
    return 1;
  }

  if (options.help) {
    io.log(HELP);
    return 0;
  }

  try {
    io.log(JSON.stringify(inventoryRepository(options), null, 2));
    return 0;
  } catch (error) {
    io.error(`error: ${error.message}`);
    return 2;
  }
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  process.exitCode = runCli();
}
