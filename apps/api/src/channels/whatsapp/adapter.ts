import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { type Router } from 'express';
import type { BotPolicy } from '@moneybee/shared';
import { BotMachine, getOrCreateSession, type Inbound, type Reply } from '../../bot';
import { loadBotPolicy } from '../../bot/policy';
import { composeNudges } from '../../bot/notify';
import type { Ctx } from '../../context';
import type { BotSessionRec } from '../../db/types';
import type { JobQueue } from '../../queue';
import { WA, clip, type WhatsAppClient } from './client';

/**
 * WhatsApp Cloud API adapter. Translates Meta webhook events into bot turns and bot replies into
 * WhatsApp messages. No onboarding logic lives here.
 */
export interface WhatsAppAdapterOptions {
  verifyToken: string;
  appSecret: string;
  client: WhatsAppClient;
  /** language code for templates */
  templateLang?: { en: string; ar: string };
  botPolicy?: BotPolicy;
  /** process inbound inline (tests) instead of after acknowledging the webhook */
  inline?: boolean;
  /** WHATSAPP_MODE=mock: expose the recorded outbox and a media upload route for scripts/wa-sim.mjs. Never set in live mode. */
  mock?: ReturnType<typeof import('./client').createMockWhatsAppClient>;
}

/* ---------- Meta webhook payload (the parts we read) ---------- */
interface MetaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: { type: 'button_reply' | 'list_reply'; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  image?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string };
  button?: { text: string; payload: string };
}
interface MetaWebhook {
  object?: string;
  entry?: { id: string; changes?: { field: string; value: { metadata?: { phone_number_id: string }; messages?: MetaMessage[]; statuses?: unknown[] } }[] }[];
}

const SEEN_MAX = 5000;

export class WhatsAppAdapter {
  private machine: BotMachine;
  private bot: BotPolicy;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private templateLang: { en: string; ar: string };
  /** one turn at a time per session so a burst of uploads is processed in order */
  private chains = new Map<string, Promise<unknown>>();

  constructor(private ctx: Ctx, queue: JobQueue, private opts: WhatsAppAdapterOptions) {
    this.bot = opts.botPolicy ?? loadBotPolicy();
    this.machine = new BotMachine(ctx, queue, this.bot);
    this.templateLang = opts.templateLang ?? { en: 'en', ar: 'ar' };
  }

  /* ---------- Express routes ---------- */
  router(): Router {
    const r = express.Router();
    // Meta verification handshake
    r.get('/channels/whatsapp/webhook', (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && typeof token === 'string' && safeEq(token, this.opts.verifyToken) && typeof challenge === 'string') return res.status(200).send(challenge);
      return res.sendStatus(403);
    });
    // raw body is needed for the signature; the app-level JSON parser has not touched this route (mounted before it)
    r.post('/channels/whatsapp/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
      const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
      if (!this.verifySignature(raw, req.header('x-hub-signature-256'))) return res.sendStatus(401);
      let payload: MetaWebhook;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return res.sendStatus(400);
      }
      if (payload.object !== 'whatsapp_business_account') return res.sendStatus(200);
      const work = this.processWebhook(payload).catch((e) => this.ctx.log.error(`whatsapp webhook failed: ${e instanceof Error ? e.message : e}`));
      if (this.opts.inline) await work;
      // Meta retries if we do not answer quickly; acknowledge first, process after
      return res.sendStatus(200);
    });
    if (this.opts.mock) {
      const mock = this.opts.mock;
      r.get('/channels/whatsapp/mock/outbox', (req, res) => {
        const from = String(req.query.from ?? '');
        res.json({ sent: mock.sent.filter((m) => !from || m.to === from) });
      });
      r.post('/channels/whatsapp/mock/media', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
        const id = `mock-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        mock.media[id] = { data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), mime: String(req.header('x-mime') ?? 'application/pdf'), name: String(req.header('x-filename') ?? 'upload.pdf') };
        res.status(201).json({ id });
      });
    }
    return r;
  }

  verifySignature(raw: Buffer, header: string | undefined): boolean {
    if (!header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', this.opts.appSecret).update(raw).digest('hex');
    return safeEq(header.slice(7), expected);
  }

  /* ---------- inbound ---------- */
  async processWebhook(p: MetaWebhook): Promise<void> {
    for (const e of p.entry ?? []) {
      for (const ch of e.changes ?? []) {
        if (ch.field !== 'messages') continue;
        for (const m of ch.value.messages ?? []) {
          if (this.isDuplicate(m.id)) continue;
          await this.enqueue(m.from, () => this.handleMessage(m));
        }
      }
    }
  }

  private enqueue(from: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(from) ?? Promise.resolve();
    const next = prev.then(fn, fn).finally(() => {
      if (this.chains.get(from) === next) this.chains.delete(from);
    });
    this.chains.set(from, next);
    return next;
  }

  private isDuplicate(id: string): boolean {
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > SEEN_MAX) this.seen.delete(this.seenOrder.shift()!);
    return false;
  }

  async handleMessage(m: MetaMessage): Promise<void> {
    const inbound = await this.toInbound(m);
    if (!inbound) return;
    const { session } = await getOrCreateSession(this.ctx, 'whatsapp', m.from);
    await this.opts.client.markRead(m.id).catch(() => undefined);
    const { replies } = await this.machine.handle(session, inbound);
    for (const r of replies) await this.sendReply(m.from, session, r);
    await this.drainOutbox(session.id);
  }

  private async toInbound(m: MetaMessage): Promise<Inbound | null> {
    switch (m.type) {
      case 'text':
        return { type: 'text', text: m.text?.body ?? '' };
      case 'interactive': {
        const i = m.interactive;
        const reply = i?.type === 'button_reply' ? i.button_reply : i?.list_reply;
        return reply ? { type: 'choice', id: reply.id, label: reply.title } : { type: 'unsupported' };
      }
      case 'button':
        // quick-reply button on a template message
        return { type: 'text', text: m.button?.payload ?? m.button?.text ?? '' };
      case 'image':
      case 'document': {
        const media = m.type === 'image' ? m.image! : m.document!;
        if (!/^(image\/(png|jpe?g)|application\/pdf)$/.test(media.mime_type)) return { type: 'unsupported' };
        try {
          const f = await this.opts.client.downloadMedia(media.id);
          const name = m.type === 'document' && m.document?.filename ? m.document.filename : f.name;
          return { type: 'media', name, mime: f.mime || media.mime_type, data: f.data };
        } catch (e) {
          this.ctx.log.warn(`media download failed: ${e instanceof Error ? e.message : e}`);
          return { type: 'unsupported' };
        }
      }
      case 'reaction':
        return null;
      default:
        return { type: 'unsupported' };
    }
  }

  /* ---------- outbound ---------- */
  async sendReply(to: string, session: BotSessionRec, r: Reply): Promise<void> {
    const id = await (async () => {
      if (!r.options?.length) return this.opts.client.sendText(to, r.text);
      if (r.options.length <= WA.maxButtons) return this.opts.client.sendButtons(to, r.text, r.options.map((o) => ({ id: o.id, title: clip(o.label, WA.buttonTitle) })));
      const label = session.lang === 'ar' ? 'اختر' : 'Choose';
      return this.opts.client.sendList(to, r.text, label, r.options.slice(0, WA.maxRows).map((o) => ({ id: o.id, title: clip(o.label, WA.listRowTitle) })));
    })();
    if (!id) this.ctx.log.warn(`whatsapp reply not delivered (session ${session.id})`);
  }

  /** Send queued decision/nudge messages. Outside the 24h customer-service window only an approved template is allowed. */
  async drainOutbox(sessionId: string): Promise<number> {
    const s = await this.ctx.store.botSessions.get(sessionId);
    if (!s || s.channel !== 'whatsapp') return 0;
    const pending = s.outbox.filter((o) => !o.sentAt);
    if (!pending.length) return 0;
    const to = this.ctx.cipher.decrypt(s.channelIdEnc);
    const insideWindow = this.ctx.now().getTime() - new Date(s.lastInboundAt).getTime() < 24 * 3600 * 1000;
    let n = 0;
    for (const o of pending) {
      let id: string | null = null;
      if (insideWindow) id = await this.opts.client.sendText(to, o.text);
      else if (o.template) id = await this.opts.client.sendTemplate(to, { name: o.template.name, lang: this.templateLang[s.lang], bodyParams: o.template.params });
      else {
        this.ctx.log.warn(`outbox ${o.id}: outside 24h window and no template; left pending`);
        continue;
      }
      if (id) {
        o.sentAt = this.ctx.now().toISOString();
        n++;
      }
    }
    s.lastOutboundAt = this.ctx.now().toISOString();
    await this.ctx.store.botSessions.put(s);
    return n;
  }

  /** Periodic: compose nudges for idle sessions and drain every session with pending outbox items. */
  async tick(): Promise<{ nudged: number; sent: number }> {
    const nudged = await composeNudges(this.ctx, this.bot.session);
    let sent = 0;
    const sessions = await this.ctx.store.botSessions.list({ limit: 500 });
    for (const s of sessions) if (s.channel === 'whatsapp' && s.outbox.some((o) => !o.sentAt)) sent += await this.drainOutbox(s.id);
    return { nudged, sent };
  }
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
