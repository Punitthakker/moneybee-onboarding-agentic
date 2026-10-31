import { timingSafeEqual } from 'node:crypto';
import express, { type Router } from 'express';
import type { BotPolicy } from '@moneybee/shared';
import { BotMachine, getOrCreateSession, type Inbound, type Reply } from '../../bot';
import { composeNudges } from '../../bot/notify';
import { loadBotPolicy } from '../../bot/policy';
import type { Ctx } from '../../context';
import type { BotSessionRec } from '../../db/types';
import type { JobQueue } from '../../queue';
import { type TelegramClient } from './client';

/**
 * Telegram Bot API adapter. Same job as the WhatsApp adapter: translate updates into bot turns and
 * replies into Telegram messages. No onboarding logic here.
 * Differences from WhatsApp: no 24h window (outbox is always free text), inline keyboards instead of
 * buttons/lists, /start <payload> deep links carry a partner or referral code.
 */
export interface TelegramAdapterOptions {
  /** value Telegram echoes in X-Telegram-Bot-Api-Secret-Token; set with setWebhook */
  webhookSecret: string;
  client: TelegramClient;
  botPolicy?: BotPolicy;
  inline?: boolean;
  mock?: ReturnType<typeof import('./client').createMockTelegramClient>;
}

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; language_code?: string };
    chat: { id: number; type: string };
    text?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    photo?: { file_id: string; file_size?: number; width: number; height: number }[];
    sticker?: unknown;
    voice?: unknown;
    video?: unknown;
    location?: unknown;
    contact?: unknown;
  };
  callback_query?: { id: string; from: { id: number }; message?: { message_id: number; chat: { id: number } }; data?: string };
}

const SEEN_MAX = 5000;

export class TelegramAdapter {
  private machine: BotMachine;
  private bot: BotPolicy;
  private seen = new Set<number>();
  private seenOrder: number[] = [];
  private chains = new Map<string, Promise<unknown>>();

  constructor(private ctx: Ctx, queue: JobQueue, private opts: TelegramAdapterOptions) {
    this.bot = opts.botPolicy ?? loadBotPolicy();
    this.machine = new BotMachine(ctx, queue, this.bot);
  }

  router(): Router {
    const r = express.Router();
    r.post('/channels/telegram/webhook', express.json({ limit: '1mb' }), async (req, res) => {
      const hdr = req.header('x-telegram-bot-api-secret-token') ?? '';
      if (!safeEq(hdr, this.opts.webhookSecret)) return res.sendStatus(401);
      const u = req.body as TgUpdate;
      if (!u || typeof u.update_id !== 'number') return res.sendStatus(400);
      const work = this.processUpdate(u).catch((e) => this.ctx.log.error(`telegram update failed: ${e instanceof Error ? e.message : e}`));
      if (this.opts.inline) await work;
      return res.sendStatus(200);
    });
    if (this.opts.mock) {
      const mock = this.opts.mock;
      r.get('/channels/telegram/mock/outbox', (req, res) => {
        const chat = String(req.query.chat ?? '');
        res.json({ sent: mock.sent.filter((m) => !chat || m.chatId === chat) });
      });
      r.post('/channels/telegram/mock/file', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
        const id = `mock-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        mock.files[id] = { data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), mime: String(req.header('x-mime') ?? 'application/pdf'), name: String(req.header('x-filename') ?? 'upload.pdf') };
        res.status(201).json({ id });
      });
    }
    return r;
  }

  async processUpdate(u: TgUpdate): Promise<void> {
    if (this.isDuplicate(u.update_id)) return;
    if (u.callback_query) {
      const q = u.callback_query;
      const chatId = String(q.message?.chat.id ?? q.from.id);
      await this.enqueue(chatId, async () => {
        await this.opts.client.answerCallback(q.id).catch(() => undefined);
        if (q.message) await this.opts.client.clearKeyboard(chatId, q.message.message_id).catch(() => undefined);
        await this.turn(chatId, { type: 'choice', id: q.data ?? '' }, u.message?.from?.language_code);
      });
      return;
    }
    const m = u.message;
    if (!m || m.chat.type !== 'private') return; // groups are not supported
    const chatId = String(m.chat.id);
    await this.enqueue(chatId, async () => {
      const inbound = await this.toInbound(m);
      if (inbound) await this.turn(chatId, inbound, m.from?.language_code);
    });
  }

  private async turn(chatId: string, inbound: Inbound, languageCode?: string): Promise<void> {
    const { session, created } = await getOrCreateSession(this.ctx, 'telegram', chatId, languageCode?.startsWith('ar') ? 'ar' : 'en');
    // /start <payload>: deep link with a partner or referral code, e.g. t.me/MoneyBeeBot?start=pemo
    if (inbound.type === 'text' && /^\/start(\s|$)/.test(inbound.text)) {
      const payload = inbound.text.replace(/^\/start\s*/, '').trim().slice(0, 64);
      if (payload && /^[\w-]+$/.test(payload)) session.referral = payload;
      inbound = { type: 'text', text: created ? 'hi' : 'continue' };
    }
    const { replies } = await this.machine.handle(session, inbound);
    for (const r of replies) await this.sendReply(chatId, r);
    await this.drainOutbox(session.id);
  }

  private async toInbound(m: NonNullable<TgUpdate['message']>): Promise<Inbound | null> {
    if (typeof m.text === 'string') return { type: 'text', text: m.text };
    if (m.document) {
      const mime = m.document.mime_type ?? '';
      if (!/^(image\/(png|jpe?g)|application\/pdf)$/.test(mime)) return { type: 'unsupported' };
      return this.download(m.document.file_id, m.document.file_name, mime);
    }
    if (m.photo?.length) {
      const best = m.photo[m.photo.length - 1]; // largest size last
      return this.download(best.file_id, undefined, 'image/jpeg');
    }
    if (m.sticker || m.voice || m.video || m.location || m.contact) return { type: 'unsupported' };
    return null;
  }

  private async download(fileId: string, name: string | undefined, mime: string): Promise<Inbound> {
    try {
      const f = await this.opts.client.downloadFile(fileId);
      return { type: 'media', name: name ?? f.name, mime: mime || f.mime, data: f.data };
    } catch (e) {
      this.ctx.log.warn(`telegram file download failed: ${e instanceof Error ? e.message : e}`);
      return { type: 'unsupported' };
    }
  }

  async sendReply(chatId: string, r: Reply): Promise<void> {
    const id = r.options?.length ? await this.opts.client.sendKeyboard(chatId, r.text, r.options.map((o) => ({ id: o.id, title: o.label }))) : await this.opts.client.sendText(chatId, r.text);
    if (id == null) this.ctx.log.warn(`telegram reply not delivered (chat ${chatId.replace(/\d(?=\d{3})/g, '*')})`);
  }

  /** Telegram has no messaging window: everything in the outbox goes as plain text. */
  async drainOutbox(sessionId: string): Promise<number> {
    const s = await this.ctx.store.botSessions.get(sessionId);
    if (!s || s.channel !== 'telegram') return 0;
    const pending = s.outbox.filter((o) => !o.sentAt);
    if (!pending.length) return 0;
    const chatId = this.ctx.cipher.decrypt(s.channelIdEnc);
    let n = 0;
    for (const o of pending) {
      const id = await this.opts.client.sendText(chatId, o.text);
      if (id != null) {
        o.sentAt = this.ctx.now().toISOString();
        n++;
      }
    }
    s.lastOutboundAt = this.ctx.now().toISOString();
    await this.ctx.store.botSessions.put(s);
    return n;
  }

  async tick(): Promise<{ nudged: number; sent: number }> {
    const nudged = await composeNudges(this.ctx, this.bot.session);
    let sent = 0;
    const sessions = await this.ctx.store.botSessions.list({ limit: 500 });
    for (const s of sessions) if (s.channel === 'telegram' && s.outbox.some((o) => !o.sentAt)) sent += await this.drainOutbox(s.id);
    return { nudged, sent };
  }

  private enqueue(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn).finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
    this.chains.set(key, next);
    return next;
  }

  private isDuplicate(id: number): boolean {
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > SEEN_MAX) this.seen.delete(this.seenOrder.shift()!);
    return false;
  }
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export type { BotSessionRec };
