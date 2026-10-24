import { writeFileSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './core/config.js';
import { seedSandbox } from './sandbox.js';

const config = loadConfig();
const { app, services } = await buildApp({ config, logger: true });

// Synthetic tenants and keys exist only in the sandbox. A production process must never create them.
if (config.env === 'sandbox') {
  const world = seedSandbox(services);
  // Sandbox keys go to a git-ignored file, never to the log.
  writeFileSync('.sandbox-keys.json', JSON.stringify(world.credentials, null, 2), { mode: 0o600 });
} else {
  app.log.warn('MB_ENV is not "sandbox": no sandbox tenants were created. This build has only an in-memory store, so it cannot serve real traffic.');
}

const timer = setInterval(() => {
  services.worker.tick().catch((e) => app.log.error({ err: String(e) }, 'webhook worker tick failed'));
}, 1000);
timer.unref();

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`MoneyBee Open API sandbox listening on :${config.port}. Sandbox keys, if created, are in .sandbox-keys.json (git-ignored).`);
if (config.includeTemplate) app.log.warn('Module template is enabled. It is a demo module, not part of the product.');
