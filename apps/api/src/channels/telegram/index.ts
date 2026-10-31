import type { Ctx } from '../../context';
import type { JobQueue } from '../../queue';
import { TelegramAdapter } from './adapter';
import { createMockTelegramClient, createTelegramClient, type TelegramClient } from './client';

export { TelegramAdapter } from './adapter';
export { createMockTelegramClient, createTelegramClient, type TelegramClient } from './client';

/** Builds the adapter from config. Returns null when TELEGRAM_MODE=off. Registers the webhook with Telegram in live mode. */
export async function createTelegramAdapter(ctx: Ctx, queue: JobQueue): Promise<{ adapter: TelegramAdapter; client: TelegramClient; stop(): void } | null> {
  const cfg = ctx.cfg;
  if (cfg.TELEGRAM_MODE === 'off') return null;
  const webhookSecret = cfg.TELEGRAM_WEBHOOK_SECRET || (cfg.TELEGRAM_MODE === 'mock' ? 'mock-telegram-secret' : undefined);
  if (!webhookSecret) throw new Error('TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_MODE=live');
  let client: TelegramClient;
  let mock: ReturnType<typeof createMockTelegramClient> | undefined;
  if (cfg.TELEGRAM_MODE === 'live') {
    if (!cfg.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required when TELEGRAM_MODE=live');
    client = createTelegramClient(cfg.TELEGRAM_BOT_TOKEN, ctx.log);
    if (cfg.TELEGRAM_SET_WEBHOOK_ON_BOOT) {
      const url = `${cfg.PUBLIC_API_URL}/api/v1/channels/telegram/webhook`;
      const ok = await client.setWebhook(url, webhookSecret);
      ctx.log.info({ url, ok }, ok ? 'Telegram webhook registered' : 'Telegram webhook registration FAILED (PUBLIC_API_URL must be public https)');
    }
  } else {
    mock = createMockTelegramClient();
    client = mock;
    const m = mock;
    for (const k of ['sendText', 'sendKeyboard'] as const) {
      const orig = m[k] as (...a: unknown[]) => Promise<number | null>;
      (m as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
        const id = await orig(...a);
        const last = m.sent[m.sent.length - 1];
        ctx.log.info({ chat: String(a[0]).replace(/\d(?=\d{3})/g, '*'), kind: last?.kind, options: last?.options?.map((o) => o.id) }, `[TELEGRAM MOCK] ${(last?.body ?? '').slice(0, 160).replace(/\n/g, ' ')}`);
        return id;
      };
    }
  }
  const adapter = new TelegramAdapter(ctx, queue, { webhookSecret, client, mock });
  const prev = ctx.onBotOutbox;
  ctx.onBotOutbox = async (sessionId) => {
    await prev?.(sessionId);
    await adapter.drainOutbox(sessionId);
  };
  const timer = setInterval(() => void adapter.tick().catch((e) => ctx.log.warn(`telegram tick failed: ${e instanceof Error ? e.message : e}`)), cfg.BOT_TICK_SECONDS * 1000);
  timer.unref();
  return { adapter, client, stop: () => clearInterval(timer) };
}
