import type { Config } from '../config';
import { createMemoryStore } from './memory-store';
import type { Store } from './types';

export async function createStore(cfg: Config): Promise<Store> {
  if (cfg.STORE === 'memory') return createMemoryStore();
  const { createMongoStore } = await import('./mongo-store');
  return createMongoStore(cfg.MONGO_URL);
}
export * from './types';
