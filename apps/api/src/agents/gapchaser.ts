import type { Ctx } from '../context';
import type { CaseRec, GapItem } from '../db/types';
import { GapOut } from './schemas';
import { GAP_CHASER_SYSTEM, PROMPT_VERSIONS } from './prompts';
import type { StepHandle } from './runtime';

/** Lists missing, expired and low-confidence items and drafts a merchant message. The message is NEVER sent automatically. */
export async function draftGapMessage(_ctx: Ctx, h: StepHandle, c: CaseRec, items: GapItem[]): Promise<string> {
  if (!items.length) return '';
  const lines = Array.from(new Set(items.map((i) => i.message)));
  const r = await h.llm({
    agent: 'gap_chaser',
    promptVersion: PROMPT_VERSIONS.gapChaser,
    system: GAP_CHASER_SYSTEM,
    user: `Merchant: ${c.legalName ?? c.name}\nOutstanding items:\n${lines.map((l) => `- ${l}`).join('\n')}`,
    schema: GapOut,
    mockContext: { items: lines },
    maxTokens: 1200,
  });
  return r.output.message;
}
