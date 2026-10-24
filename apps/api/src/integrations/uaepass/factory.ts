import type { Config } from '../../config';
import { LiveUaePassProvider } from './live';
import { MockUaePassProvider } from './mock';
import type { UaePassProvider } from './types';

export function createUaePassProvider(cfg: Config): UaePassProvider {
  return cfg.UAEPASS_MODE === 'live' ? new LiveUaePassProvider(cfg) : new MockUaePassProvider(cfg);
}
