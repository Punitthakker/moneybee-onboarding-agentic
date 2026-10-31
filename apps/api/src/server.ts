import { loadConfig } from './config';
import { makeLogger } from './logger';
import { buildCtx } from './bootstrap';
import { createApp } from './app';
import { createBullQueue, createInlineQueue } from './queue';
import { seedUsers } from './auth';
import { createWhatsAppAdapter } from './channels/whatsapp';

async function main() {
  const cfg = loadConfig();
  const log = makeLogger(cfg.LOG_LEVEL);
  const ctx = await buildCtx(cfg, log);
  await ctx.blobs.init();
  await ctx.repo.migrate();
  await seedUsers(ctx);
  const queue = cfg.QUEUE_MODE === 'inline' ? createInlineQueue(() => ctx) : createBullQueue(() => ctx);
  const whatsapp = createWhatsAppAdapter(ctx, queue);
  const app = createApp(ctx, queue, { whatsapp: whatsapp?.adapter });
  if (whatsapp) log.info({ mode: cfg.WHATSAPP_MODE }, 'WhatsApp onboarding bot enabled');
  const server = app.listen(cfg.PORT, () => log.info({ port: cfg.PORT, llm: ctx.llm.isMock ? 'MOCK' : 'live', store: cfg.STORE, repo: cfg.REPO }, 'MoneyBee Onboard API listening'));
  const stop = async () => {
    log.info('shutting down');
    server.close();
    whatsapp?.stop();
    await queue.close();
    await ctx.store.close();
    await ctx.repo.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fatal', e);
  process.exit(1);
});
