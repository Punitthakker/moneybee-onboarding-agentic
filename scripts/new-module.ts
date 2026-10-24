import { scaffoldModule } from './lib/scaffold.js';

const [id, resource, plural, prefix] = process.argv.slice(2);
if (!id || !resource || !plural) {
  console.error('Usage: npm run new:module -- <module-id> <resource> <plural> [id-prefix]\nExample: npm run new:module -- onboarding application applications app');
  process.exit(2);
}
try {
  const r = scaffoldModule({ id, resource, plural, prefix });
  for (const f of r.created) console.log(`created  ${f}`);
  for (const f of r.edited) console.log(`edited   ${f}`);
  console.log('\nNext: replace the example fields, scopes and events, implement the handlers, run "npm run ci".');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
