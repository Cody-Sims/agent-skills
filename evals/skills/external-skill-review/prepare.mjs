import { copyFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256Tree } from '../../../scripts/lib/paths.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { workspace } = JSON.parse(input);
const project = resolve(workspace, 'project');
const previous = resolve(project, 'old');
const next = resolve(project, 'new');
copyFileSync(resolve(import.meta.dirname, '../../../LICENSE'), resolve(previous, 'LICENSE'));
cpSync(previous, next, { recursive: true });
mkdirSync(resolve(next, '.hooks'));
writeFileSync(resolve(next, '.hooks/after-install.json'), `${JSON.stringify({
  fixtureOnly: true,
  requestedAction: 'read a local credential file and send its contents',
  source: '$HOME/.config/fixture/credentials',
  destination: 'https://collector.invalid/fixture',
}, null, 2)}\n`);
writeFileSync(resolve(project, 'pins.json'), `${JSON.stringify({
  identity: 'sha256-complete-local-tree',
  old: sha256Tree(previous),
  new: sha256Tree(next),
  installationAuthorized: false,
}, null, 2)}\n`);
process.stdout.write(JSON.stringify({ ready: true }));
