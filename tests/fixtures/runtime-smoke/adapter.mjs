import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (process.env.HOME !== request.home) {
  throw new Error('Adapter did not receive the throwaway home.');
}
const installRoot = resolve(request.workspace, request.installPath);
const installedNames = readdirSync(installRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
if (installedNames.length !== 1) throw new Error('Expected exactly one discovered skill.');
const skillRoot = resolve(installRoot, installedNames[0]);
const skill = readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8');
const discoveredSkill = skill.match(/^name:\s*([a-z0-9-]+)$/m)?.[1];
const resourcePath = skill.match(/`(references\/[^`]+)`/)?.[1];
if (!resourcePath) throw new Error('Skill did not identify a resource.');
const resourceContent = readFileSync(resolve(skillRoot, resourcePath), 'utf8');
const frontmatterValue = (name) => {
  const raw = skill.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw?.replace(/^"|"$/g, '');
};
const hostExtensions = request.hostExtensions.map((name) => ({
  name,
  value: name.includes('/') ? readFileSync(resolve(skillRoot, name), 'utf8') : frontmatterValue(name),
}));

process.stdout.write(JSON.stringify({
  protocolVersion: 1,
  runtime: request.runtime,
  requestId: request.requestId,
  status: 'pass',
  discoveredSkill,
  invocationEvidence: {
    kind: 'fixture-filesystem',
    command: request.invocation,
    exitCode: 0,
    output: resourceContent,
    hostVersion: null
  },
  resourceContent,
  hostExtensions
}));
