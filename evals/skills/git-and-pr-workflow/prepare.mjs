import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { workspace } = JSON.parse(input);
const project = resolve(workspace, 'project');
function git(...args) {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
    cwd: project, encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024,
  });
  if (result.status !== 0) throw new Error('Git fixture setup failed.');
}
git('init', '--quiet', '--initial-branch=fixture');
git('add', '--', 'docs/setup.md', 'tests/login.test.mjs');
git('commit', '--quiet', '-m', 'Initial fixture');
writeFileSync(resolve(project, 'docs/setup.md'), 'First documentation update.\n');
git('add', '--', 'docs/setup.md');
git('commit', '--quiet', '-m', 'First documentation update');
writeFileSync(resolve(project, 'docs/setup.md'), 'Second documentation update, not committed.\n');
writeFileSync(resolve(project, 'tests/login.test.mjs'), "export const otherOwnerCase = 'staged by another owner';\n");
git('add', '--', 'tests/login.test.mjs');
process.stdout.write(JSON.stringify({ ready: true }));
