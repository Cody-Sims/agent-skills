#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectDriftFromFiles } from './lib/drift-detection.mjs';
import { validateAgainstSchema } from './lib/jsonschema.mjs';
import { assertNoSymlinkComponents } from './lib/paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `Usage: node scripts/detect-drift.mjs [options]

  --baseline-behavior <path>  Baseline behavior evaluation result
  --current-behavior <path>   Current behavior evaluation result
  --baseline-routing <path>   Baseline routing evaluation result
  --current-routing <path>    Current routing evaluation result
  --baseline-runtime <path>   Baseline runtime-smoke result
  --current-runtime <path>    Current runtime-smoke result
  --lifecycle <path>          Current registry lifecycle manifest
  --as-of <YYYY-MM-DD>        Explicit comparison date
  --out <path>                Write JSON report (otherwise stdout)
  --help                      Show this help
`;

const OPTION_KEYS = new Map([
  ['baseline-behavior', 'baselineBehavior'],
  ['current-behavior', 'currentBehavior'],
  ['baseline-routing', 'baselineRouting'],
  ['current-routing', 'currentRouting'],
  ['baseline-runtime', 'baselineRuntime'],
  ['current-runtime', 'currentRuntime'],
  ['lifecycle', 'lifecycle'],
  ['as-of', 'asOf'],
  ['out', 'out'],
]);

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (!argument.startsWith('--') || !OPTION_KEYS.has(argument.slice(2))) {
      throw new Error(`Unknown argument: ${argument}.`);
    }
    const key = OPTION_KEYS.get(argument.slice(2));
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    if (options[key] !== undefined) throw new Error(`${argument} may be supplied only once.`);
    options[key] = value;
    index += 1;
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const report = detectDriftFromFiles(options);
  const schema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/drift-report.schema.json'), 'utf8'));
  const errors = validateAgainstSchema(schema, report);
  if (errors.length > 0) throw new Error(`Generated drift report is invalid:\n${errors.join('\n')}`);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const outputPath = assertNoSymlinkComponents(options.out);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, { flag: 'w' });
    process.stdout.write(`Detected ${report.findings.length} drift regressions; wrote sanitized report.\n`);
  } else {
    process.stdout.write(serialized);
  }
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Drift detection failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
