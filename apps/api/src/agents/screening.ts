import type { ScreeningResultRec } from '../db/types';
import { nameSimilarity } from './names';

export interface ScreeningSubject {
  key: string;
  name: string;
  role: string;
  kind: 'company' | 'person';
  nationality?: string;
  dob?: string;
}

/**
 * Real providers (sanctions, PEP, adverse media vendors) implement this interface.
 * Implementations must set isMock=false only when a real external screening was performed.
 */
export interface ScreeningProvider {
  readonly name: string;
  readonly isMock: boolean;
  screen(subjects: ScreeningSubject[]): Promise<ScreeningResultRec[]>;
}

/** MOCK provider with a tiny built-in list of obviously fake names (see docs/MOCKS.md). It performs no real screening. */
const MOCK_LIST: { name: string; category: 'SANCTIONS' | 'PEP' | 'ADVERSE_MEDIA'; detail: string }[] = [
  { name: 'Testov Sanctionedov', category: 'SANCTIONS', detail: 'MOCK sanctions list entry (synthetic)' },
  { name: 'Sanctioned Holdings Test FZE', category: 'SANCTIONS', detail: 'MOCK sanctions list entry (synthetic)' },
  { name: 'Demo Politician', category: 'PEP', detail: 'MOCK PEP list entry (synthetic)' },
  { name: 'Shady Adverse Trading', category: 'ADVERSE_MEDIA', detail: 'MOCK adverse media entry (synthetic)' },
];

export function createMockScreeningProvider(): ScreeningProvider {
  return {
    name: 'MOCK_SCREENING',
    isMock: true,
    async screen(subjects) {
      return subjects.map((s): ScreeningResultRec => {
        const hit = MOCK_LIST.find((m) => nameSimilarity(m.name, s.name) >= 0.92);
        if (hit) return { partyKey: s.key, subject: s.name, role: s.role, status: 'HIT', category: hit.category, detail: hit.detail, rawRef: `mock:${hit.category.toLowerCase()}` };
        return { partyKey: s.key, subject: s.name, role: s.role, status: 'CLEAR', category: null, detail: 'No match in MOCK list', rawRef: 'mock:clear' };
      });
    },
  };
}

export function createScreeningProvider(name: string): ScreeningProvider {
  if (name === 'mock') return createMockScreeningProvider();
  throw new Error(`Screening provider "${name}" is not implemented. Implement ScreeningProvider and register it in createScreeningProvider.`);
}
