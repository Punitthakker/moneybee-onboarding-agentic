import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { resolveLlmMode, type Config } from './config';
import type { Ctx } from './context';
import { PiiCipher } from './crypto/pii';
import { createStore } from './db';
import type { Store } from './db/types';
import { EventBus } from './events';
import { apiSubmitMockAdapter, filePackAdapter } from './agents/packbuilder';
import { createScreeningProvider } from './agents/screening';
import type { LlmClient } from './llm/client';
import { createAnthropicClient } from './llm/anthropic';
import { createMockLlm } from './llm/mock';
import type { Logger } from './logger';
import { PolicyService } from './policy/service';
import { createRepository } from './sql';
import type { OnboardingRepository } from './sql/repository';
import { createBlobStore, createMemoryBlobStore, type BlobStore } from './storage';

export interface BuildOverrides {
  store?: Store;
  repo?: OnboardingRepository;
  blobs?: BlobStore;
  llm?: LlmClient;
  now?: () => Date;
}

/** Wires every dependency. Tests inject in-memory implementations through overrides. */
export async function buildCtx(cfg: Config, log: Logger, o: BuildOverrides = {}): Promise<Ctx> {
  let piiKey = cfg.PII_ENC_KEY;
  if (!piiKey) {
    piiKey = randomBytes(32).toString('base64');
    log.warn('PII_ENC_KEY not set: using an ephemeral key. Encrypted data will NOT survive a restart. Set PII_ENC_KEY (32 bytes, base64).');
  }
  const cipher = new PiiCipher(cfg.PII_ENC_KEY_ID, { [cfg.PII_ENC_KEY_ID]: piiKey });
  const store = o.store ?? (await createStore(cfg));
  const repo = o.repo ?? createRepository(cfg, log);
  const blobs = o.blobs ?? (cfg.STORAGE === 'local' && cfg.STORE === 'memory' ? createMemoryBlobStore() : createBlobStore(cfg, new PiiCipher(cfg.PII_ENC_KEY_ID, { [cfg.PII_ENC_KEY_ID]: cfg.FILE_ENC_KEY ?? piiKey })));
  const llm = o.llm ?? (resolveLlmMode(cfg) === 'live' ? createAnthropicClient(cfg) : createMockLlm());
  const policies = new PolicyService(store);
  await policies.init();
  const fileUrlSecret = createHash('sha256').update(`file-url:${cfg.JWT_SECRET || piiKey}`).digest('base64url');
  return {
    cfg, log, store, repo, blobs, cipher, llm, policies, bus: new EventBus(), screening: createScreeningProvider(cfg.SCREENING_PROVIDER),
    adapters: { file_pack: filePackAdapter, api_submit_mock: apiSubmitMockAdapter }, fileUrlSecret, now: o.now ?? (() => new Date()),
  };
}
