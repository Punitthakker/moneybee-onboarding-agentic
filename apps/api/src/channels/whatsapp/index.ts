import type { Ctx } from '../../context';
import type { JobQueue } from '../../queue';
import { WhatsAppAdapter } from './adapter';
import { createMockWhatsAppClient, createWhatsAppClient, type WhatsAppClient } from './client';

export { WhatsAppAdapter } from './adapter';
export { createMockWhatsAppClient, createWhatsAppClient, type WhatsAppClient } from './client';

/** Builds the adapter from config. Returns null when WHATSAPP_MODE=off. Starts the outbox/nudge sweep. */
export function createWhatsAppAdapter(ctx: Ctx, queue: JobQueue): { adapter: WhatsAppAdapter; client: WhatsAppClient; stop(): void } | null {
  const cfg = ctx.cfg;
  if (cfg.WHATSAPP_MODE === 'off') return null;
  const verifyToken = cfg.WHATSAPP_VERIFY_TOKEN || (cfg.WHATSAPP_MODE === 'mock' ? 'mock-verify' : undefined);
  const appSecret = cfg.WHATSAPP_APP_SECRET || (cfg.WHATSAPP_MODE === 'mock' ? 'mock-app-secret' : undefined);
  if (!verifyToken || !appSecret) throw new Error('WHATSAPP_VERIFY_TOKEN and WHATSAPP_APP_SECRET are required when WHATSAPP_MODE=live');
  let client: WhatsAppClient;
  let mock: ReturnType<typeof createMockWhatsAppClient> | undefined;
  if (cfg.WHATSAPP_MODE === 'live') {
    if (!cfg.WHATSAPP_ACCESS_TOKEN || !cfg.WHATSAPP_PHONE_NUMBER_ID) throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WHATSAPP_MODE=live');
    client = createWhatsAppClient({ accessToken: cfg.WHATSAPP_ACCESS_TOKEN, phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID, apiVersion: cfg.WHATSAPP_API_VERSION }, ctx.log);
  } else {
    mock = createMockWhatsAppClient();
    client = mock;
    // dev aid: log what the bot would have sent
    const m = mock;
    const wrap = <K extends 'sendText' | 'sendButtons' | 'sendList' | 'sendTemplate'>(k: K) => {
      const orig = m[k] as (...a: unknown[]) => Promise<string | null>;
      (m as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
        const id = await orig(...a);
        const last = m.sent[m.sent.length - 1];
        ctx.log.info({ to: String(a[0]).replace(/\d(?=\d{4})/g, '*'), kind: last?.kind, options: last?.options?.map((o) => o.id) }, `[WHATSAPP MOCK] ${(last?.body ?? '').slice(0, 160).replace(/\n/g, ' ')}`);
        return id;
      };
    };
    (['sendText', 'sendButtons', 'sendList', 'sendTemplate'] as const).forEach(wrap);
  }
  const adapter = new WhatsAppAdapter(ctx, queue, { verifyToken, appSecret, client, mock, templateLang: { en: cfg.WHATSAPP_TEMPLATE_LANG_EN, ar: cfg.WHATSAPP_TEMPLATE_LANG_AR } });
  ctx.onBotOutbox = (sessionId) => adapter.drainOutbox(sessionId).then(() => undefined);
  const timer = setInterval(() => void adapter.tick().catch((e) => ctx.log.warn(`bot tick failed: ${e instanceof Error ? e.message : e}`)), cfg.BOT_TICK_SECONDS * 1000);
  timer.unref();
  return { adapter, client, stop: () => clearInterval(timer) };
}
