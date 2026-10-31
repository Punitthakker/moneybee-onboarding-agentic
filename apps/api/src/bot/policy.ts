import fs from 'node:fs';
import path from 'node:path';
import { BotPolicySchema, type ActivityFlag, type BotMccTier, type BotPolicy, type MccCatalogueEntry, type Stage1Category } from '@moneybee/shared';
import { findPoliciesDir } from '../policy/service';

const ORDER: Record<BotMccTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, RESTRICTED: 3, PROHIBITED: 4 };

let cached: BotPolicy | null = null;

/** Reads and validates /policies/bot.json once. Throws at boot if invalid. */
export function loadBotPolicy(root = process.cwd()): BotPolicy {
  if (cached) return cached;
  const dir = findPoliciesDir(root);
  cached = BotPolicySchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'bot.json'), 'utf8')));
  return cached;
}

/** test hook */
export function setBotPolicyForTests(p: BotPolicy | null) {
  cached = p;
}

export function catalogueEntry(p: BotPolicy, mcc: string): MccCatalogueEntry | undefined {
  return p.mccCatalogue.find((e) => e.mcc === mcc);
}

export function candidatesFor(p: BotPolicy, category: Stage1Category | undefined): MccCatalogueEntry[] {
  if (!category || category === 'other') return p.mccCatalogue;
  return p.mccCatalogue.filter((e) => e.category === category);
}

export const maxTier = (a: BotMccTier, b: BotMccTier): BotMccTier => (ORDER[a] >= ORDER[b] ? a : b);

/** Effective tier after activity-flag overrides. */
export function effectiveTier(p: BotPolicy, mccTier: BotMccTier, flags: ActivityFlag[]): BotMccTier {
  let t = mccTier;
  for (const f of flags) {
    const r = p.activityFlagRules[f];
    if (!r) continue;
    if (r.setTier) t = maxTier(t, r.setTier);
    if (r.floorTier) t = maxTier(t, r.floorTier);
  }
  return t;
}

/** The underwriter's three-tier view of a bot tier. */
export function underwriterTier(t: BotMccTier): 'LOW' | 'MEDIUM' | 'HIGH' {
  return t === 'LOW' || t === 'MEDIUM' ? t : 'HIGH';
}
