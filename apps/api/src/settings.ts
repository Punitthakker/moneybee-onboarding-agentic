import type { Ctx } from './context';

export async function getRuntimeSettings(ctx: Ctx): Promise<{ tokenTtlHours: number; webhookUrl: string | null; webhookSecret: string }> {
  const s = await ctx.store.settings.get();
  const base = (await ctx.policies.active()).base;
  let secret = ctx.cfg.ONBOARDING_WEBHOOK_SECRET;
  if (s.webhookSecretEnc) {
    try {
      secret = ctx.cipher.decrypt(s.webhookSecretEnc);
    } catch {
      /* fall back to env */
    }
  }
  return {
    tokenTtlHours: s.tokenTtlHours ?? base.tokenTtlHours ?? ctx.cfg.TOKEN_TTL_HOURS,
    webhookUrl: s.webhookUrl ?? ctx.cfg.ONBOARDING_WEBHOOK_URL ?? null,
    webhookSecret: secret,
  };
}
