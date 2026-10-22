import { randomUUID } from 'node:crypto';
import type { WebhookPayload } from '@moneybee/shared';
import type { Ctx } from './context';
import { signWebhook } from './crypto/token';
import type { WebhookJob } from './queue';
import { getRuntimeSettings } from './settings';

export function redactPayload(p: WebhookPayload): Record<string, unknown> {
  return { ...p, token: '[redacted]', claimUrl: p.claimUrl.replace(/\/onboarding\/[^/]+\//, '/onboarding/[redacted]/') };
}

/** One delivery attempt. HMAC-SHA256 over `${timestamp}.${body}`; the receiver enforces a 5 minute replay window. */
export async function deliverWebhook(ctx: Ctx, job: WebhookJob, attempt: number): Promise<{ ok: boolean; retry: boolean; error?: string }> {
  const d = await ctx.store.webhooks.get(job.deliveryId);
  if (!d || !d.bodyEnc) return { ok: false, retry: false, error: 'delivery not found or body already cleared' };
  const body = ctx.cipher.decrypt(d.bodyEnc);
  const { webhookSecret } = await getRuntimeSettings(ctx);
  const ts = String(Math.floor(ctx.now().getTime() / 1000));
  const signature = signWebhook(webhookSecret, ts, body);
  const max = ctx.cfg.WEBHOOK_MAX_ATTEMPTS;
  try {
    const res = await fetch(d.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-moneybee-signature': signature, 'x-moneybee-timestamp': ts, 'x-moneybee-delivery': d.id, 'user-agent': 'MoneyBee-Onboard/1.0' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      await ctx.store.webhooks.update(d.id, { status: 'DELIVERED', attempts: attempt, lastStatusCode: res.status, lastError: undefined, bodyEnc: null });
      return { ok: true, retry: false };
    }
    const retry = res.status >= 500 || res.status === 429 || res.status === 408;
    const dead = !retry || attempt >= max;
    await ctx.store.webhooks.update(d.id, { status: dead ? 'DEAD' : 'RETRYING', attempts: attempt, lastStatusCode: res.status, lastError: `HTTP ${res.status}` });
    return { ok: false, retry: retry && attempt < max, error: `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const dead = attempt >= max;
    await ctx.store.webhooks.update(d.id, { status: dead ? 'DEAD' : 'RETRYING', attempts: attempt, lastError: msg });
    return { ok: false, retry: !dead, error: msg };
  }
}

export async function createDelivery(ctx: Ctx, caseId: string, url: string, payload: WebhookPayload): Promise<string> {
  const id = randomUUID();
  const now = ctx.now().toISOString();
  await ctx.store.webhooks.create({
    id, caseId, event: payload.event, url, status: 'PENDING', attempts: 0, createdAt: now, updatedAt: now,
    payloadRedacted: redactPayload(payload),
    bodyEnc: ctx.cipher.encrypt(JSON.stringify(payload)),
  });
  return id;
}
