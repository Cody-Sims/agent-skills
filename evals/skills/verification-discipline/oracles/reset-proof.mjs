import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { workspace } = JSON.parse(input);
const probe = mkdtempSync(resolve(workspace, '.reset-proof-'));
try {
  cpSync(resolve(workspace, 'project'), probe, { recursive: true });
  const run = () => spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'reset.test.mjs'], {
    cwd: probe, encoding: 'utf8', timeout: 1500, maxBuffer: 64 * 1024,
  });
  const normal = run();
  const path = resolve(probe, 'reset.mjs');
  const original = readFileSync(path, 'utf8');
  writeFileSync(path, original.replace('counters.hits = 0;', ''));
  const mutant = run();
  process.stdout.write(JSON.stringify({
    passed: normal.status === 0 && /^# pass [1-9]\d*\r?$/m.test(normal.stdout)
      && mutant.status === 1 && /ERR_ASSERTION/.test(mutant.stdout),
  }));
} finally {
  rmSync(probe, { recursive: true, force: true });
}
