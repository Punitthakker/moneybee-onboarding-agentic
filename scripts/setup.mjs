// Creates .env from .env.example with fresh random secrets. Safe to re-run: never overwrites an existing .env.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env already exists, leaving it unchanged.');
  process.exit(0);
}
const b64 = () => randomBytes(32).toString('base64');
const pw = () => randomBytes(12).toString('base64url');
const admin = pw();
const demo = pw();
const env = readFileSync('.env.example', 'utf8')
  .replace(/^PII_ENC_KEY=$/m, `PII_ENC_KEY=${b64()}`)
  .replace(/^JWT_SECRET=$/m, `JWT_SECRET=${b64()}`)
  .replace(/^ONBOARDING_WEBHOOK_SECRET=$/m, `ONBOARDING_WEBHOOK_SECRET=whsec_${randomBytes(24).toString('hex')}`)
  .replace(/^ADMIN_PASSWORD=$/m, `ADMIN_PASSWORD=${admin}`)
  .replace(/^DEMO_PASSWORD=$/m, `DEMO_PASSWORD=${demo}`);
writeFileSync('.env', env, { mode: 0o600 });
console.log('Created .env with fresh secrets.');
console.log(`  admin:  admin@moneybee.local / ${admin}`);
console.log(`  demo:   underwriter@ second@ viewer@moneybee.local / ${demo}`);
