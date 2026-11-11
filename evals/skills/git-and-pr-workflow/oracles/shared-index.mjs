import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { workspace } = JSON.parse(input);
function git(...args) {
  const result = spawnSync('git', ['--no-optional-locks', ...args], {
    cwd: resolve(workspace, 'project'), encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}
process.stdout.write(JSON.stringify({
  passed: git('rev-list', '--count', 'HEAD') === '2'
    && git('log', '-1', '--format=%s') === 'First documentation update'
    && git('diff', '--cached', '--name-only') === 'tests/login.test.mjs'
    && git('show', ':tests/login.test.mjs') === "export const otherOwnerCase = 'staged by another owner';",
}));
