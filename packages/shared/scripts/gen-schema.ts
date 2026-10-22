import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OnboardingPackageSchema, WebhookPayloadSchema } from '../src/onboarding-package';

const out = path.resolve(__dirname, '..');
writeFileSync(
  path.join(out, 'onboarding-package.schema.json'),
  JSON.stringify(zodToJsonSchema(OnboardingPackageSchema, { name: 'OnboardingPackage' }), null, 2) + '\n',
);
writeFileSync(
  path.join(out, 'webhook-payload.schema.json'),
  JSON.stringify(zodToJsonSchema(WebhookPayloadSchema, { name: 'WebhookPayload' }), null, 2) + '\n',
);
console.log('JSON schemas written');
