import { mkdirSync, writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { buildBundledSpec } from '../src/core/spec.js';

// The production bundle never includes the module template. Set MB_INCLUDE_TEMPLATE=true to include it.
const includeTemplate = process.env.MB_INCLUDE_TEMPLATE === 'true';
const doc = buildBundledSpec({ includeTemplate });

mkdirSync('dist', { recursive: true });
writeFileSync('dist/openapi.bundled.json', JSON.stringify(doc, null, 2) + '\n');
// aliasDuplicateObjects false keeps the YAML free of anchors so every tool reads it the same way.
writeFileSync('dist/openapi.bundled.yaml', stringify(doc, { aliasDuplicateObjects: false, lineWidth: 0 }));
console.log(`Bundled spec written: ${Object.keys(doc.paths).length} paths, ${Object.keys(doc.webhooks ?? {}).length} events, template ${includeTemplate ? 'included' : 'excluded'}.`);
