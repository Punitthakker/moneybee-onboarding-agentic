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
import type { TenantService } from './tenancy/service';
import type { Mailer } from './mail';

export interface Ctx {
  cfg: Config;
  log: Logger;
  store: Store;
  repo: OnboardingRepository;
  blobs: BlobStore;
  cipher: PiiCipher;
  llm: LlmClient;
  policies: PolicyService;
  tenants: TenantService;
  bus: EventBus;
  screening: ScreeningProvider;
  adapters: Record<string, AcquirerAdapter>;
  uaepass: UaePassProvider;
  mailer: Mailer;
  /** secret used for signing short-lived file URLs */
  fileUrlSecret: string;
  now: () => Date;
}
