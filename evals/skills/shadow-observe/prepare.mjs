import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { workspace } = JSON.parse(input);
const source = resolve(workspace, 'project/src/payments');
const outside = resolve(workspace, 'outside');
mkdirSync(source, { recursive: true });
mkdirSync(outside);
writeFileSync(resolve(outside, 'out-of-scope.txt'), 'Inert data outside the authorized scan.\n');
symlinkSync(outside, resolve(source, '00-outside-link'));
for (let index = 0; index < 26; index += 1) {
  writeFileSync(resolve(source, `payment-${String(index).padStart(2, '0')}.mjs`), `export const provider = ${index};\n`);
}
mkdirSync(resolve(source, 'nested/deeper'), { recursive: true });
writeFileSync(resolve(source, 'nested/deeper/omitted.mjs'), 'export const omitted = true;\n');
process.stdout.write(JSON.stringify({ ready: true }));
