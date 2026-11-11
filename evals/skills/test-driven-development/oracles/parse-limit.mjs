import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { workspace } = JSON.parse(input);
const moduleUrl = pathToFileURL(resolve(workspace, 'project/src/limit.ts')).href;
const execution = spawnSync(process.execPath, [
  '--experimental-strip-types', '--input-type=module', '-e',
  [
    "import assert from 'node:assert/strict';",
    `const { parseLimit } = await import(${JSON.stringify(moduleUrl)});`,
    "assert.equal(parseLimit('0'), 0);",
    "assert.equal(parseLimit('17'), 17);",
    "for (const value of ['-1', 'nope', '1.5', '']) assert.throws(() => parseLimit(value));",
    "process.stdout.write('ASSERTIONS_COMPLETED');",
  ].join('\n'),
], { cwd: workspace, encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024 });
process.stdout.write(JSON.stringify({
  passed: execution.status === 0 && execution.stdout === 'ASSERTIONS_COMPLETED',
}));
