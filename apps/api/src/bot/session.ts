import { createHash } from 'node:crypto';
import type { BotChannel, BotLang } from '@moneybee/shared';
import type { Ctx } from '../context';
import type { BotSessionRec } from '../db/types';

/** Stable, non-reversible session id from channel + identity (phone number or chat id). */
export function sessionIdFor(channel: BotChannel, channelId: string): string {
  return createHash('sha256').update(`${channel}:${channelId.trim()}`).digest('hex').slice(0, 32);
}

export async function getOrCreateSession(ctx: Ctx, channel: BotChannel, channelId: string, lang: BotLang = 'en'): Promise<{ session: BotSessionRec; created: boolean }> {
  const id = sessionIdFor(channel, channelId);
  const existing = await ctx.store.botSessions.get(id);
  if (existing) return { session: existing, created: false };
  const now = ctx.now().toISOString();
  const session: BotSessionRec = {
    id,
    channel,
    channelIdEnc: ctx.cipher.encrypt(channelId),
    channelIdMasked: `***${channelId.replace(/\D/g, '').slice(-4)}`,
    lang,
    step: 'S0_LANG',
    answers: { activityFlags: [] },
    transcript: [],
    outbox: [],
    nudges: {},
    createdAt: now,
    updatedAt: now,
    lastInboundAt: now,
  };
  await ctx.store.botSessions.put(session);
  return { session, created: true };
}

/** Redact obvious PII (long digit runs, emails, IBANs) before a line goes into the transcript. */
export function redact(text: string): string {
  return text
    .replace(/[A-Z]{2}\d{2}[A-Z0-9]{11,30}/g, '[iban]')
    .replace(/\b\d{7,}\b/g, '[number]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[number]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
}
