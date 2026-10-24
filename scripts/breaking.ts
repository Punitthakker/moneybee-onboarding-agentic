import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { diffSpecs } from './lib/breaking.js';

const BUNDLE = 'dist/openapi.bundled.json';
const BASELINE = 'openapi/baseline/openapi.baseline.json';

if (process.argv.includes('--write-baseline')) {
  mkdirSync('openapi/baseline', { recursive: true });
  writeFileSync(BASELINE, readFileSync(BUNDLE));
  console.log(`Baseline written to ${BASELINE}. Commit it together with the intentional change.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No baseline at ${BASELINE}. Run "npm run spec:baseline" once on the released spec.`);
  process.exit(2);
}

const changes = diffSpecs(JSON.parse(readFileSync(BASELINE, 'utf8')), JSON.parse(readFileSync(BUNDLE, 'utf8')));
const breaking = changes.filter((c) => c.severity === 'breaking');
const additive = changes.filter((c) => c.severity === 'additive');
for (const c of additive) console.log(`  additive  ${c.where}: ${c.message}`);
for (const c of breaking) console.error(`  BREAKING  ${c.where}: ${c.message}`);
console.log(`${breaking.length} breaking, ${additive.length} additive change(s) against the baseline.`);
if (breaking.length) {
  console.error('Breaking changes need a new API version (see docs/DEPRECATION.md), then "npm run spec:baseline".');
  process.exit(1);
}
