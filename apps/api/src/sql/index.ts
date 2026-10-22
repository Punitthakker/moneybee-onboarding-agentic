import path from 'node:path';
import type { Config } from '../config';
import type { Logger } from '../logger';
import { createMemoryRepository } from './memory-repository';
import { createMssqlRepository } from './mssql-repository';
import type { OnboardingRepository } from './repository';

export function createRepository(cfg: Config, log: Logger, root = process.cwd()): OnboardingRepository {
  if (cfg.REPO === 'memory') return createMemoryRepository();
  const dir = process.env.MIGRATIONS_DIR ?? findMigrations(root);
  return createMssqlRepository(cfg.MSSQL_URL, dir, log);
}

function findMigrations(root: string): string {
  for (const c of [path.resolve(root, 'db/migrations'), path.resolve(root, '../../db/migrations'), path.resolve(root, '../db/migrations')]) {
    try {
      require('node:fs').accessSync(c);
      return c;
    } catch {
      /* next */
    }
  }
  return path.resolve(root, 'db/migrations');
}
export * from './repository';
