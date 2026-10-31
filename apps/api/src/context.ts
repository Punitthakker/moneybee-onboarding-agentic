import type { Config } from './config';
import type { PiiCipher } from './crypto/pii';
import type { Store } from './db/types';
import type { EventBus } from './events';
import type { LlmClient } from './llm/client';
import type { Logger } from './logger';
import type { PolicyService } from './policy/service';
import type { ScreeningProvider } from './agents/screening';
import type { BlobStore } from './storage';
import type { OnboardingRepository } from './sql/repository';
import type { AcquirerAdapter } from './agents/packbuilder';
import type { UaePassProvider } from './integrations/uaepass/types';

export interface Ctx {
  cfg: Config;
  log: Logger;
  store: Store;
  repo: OnboardingRepository;
  blobs: BlobStore;
  cipher: PiiCipher;
  llm: LlmClient;
  policies: PolicyService;
  bus: EventBus;
  screening: ScreeningProvider;
  adapters: Record<string, AcquirerAdapter>;
  uaepass: UaePassProvider;
  /** secret used for signing short-lived file URLs */
  fileUrlSecret: string;
  now: () => Date;
  /** set by a channel adapter: called after a human decision queues a merchant message, so it is sent right away */
  onBotOutbox?: (sessionId: string) => Promise<void>;
}
