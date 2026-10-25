import { describe, expect, it } from 'vitest';
import type { CompletedRecord, OnboardingRepository } from '../src/sql/repository';
import { createMemoryRepository } from '../src/sql/memory-repository';
import { createMongoRepository, mongoRecordCollections } from '../src/sql/mongo-repository';
import { fakeRecordCollections } from './fake-mongo';

/**
 * One behaviour contract for every system-of-record implementation.
 * Runs against the in-memory repository, the MongoDB repository on an in-memory collection fake,
 * and a real MongoDB when MONGO_TEST_URL is set (for example in CI or on a laptop with Docker).
 */
const record = (over: Partial<{ caseId: string; hash: string; licence: string; scopes: ('status' | 'claim')[]; expiresAt: string }> = {}): CompletedRecord => ({
  merchant: {
    legalName: 'Desert Rose Trading FZCO', tradeName: 'Desert Rose', entityType: 'free_zone', licenceNo: over.licence ?? 'DMCC-123456', licenceAuthority: 'DMCC',
    licenceExpiry: '2027-03-31', incorporationDate: '2021-04-01', trn: '100123456700003', registeredAddress: 'JLT, Dubai', website: 'https://desertrose.example',
    mcc: '5999', expectedMonthlyVolume: 250000, expectedAvgTicket: 180, riskRating: 'LOW', status: 'ONBOARDED',
  },
  parties: [
    { role: 'UBO', fullName: 'Aisha Rahman', nationality: 'AE', dob: '1985-02-11', idType: 'emirates_id', idNumberEnc: 'enc:abc', piiKeyId: 'k1', idExpiry: '2028-01-01', ownershipPct: 60, isPep: false, screeningStatus: 'CLEAR' },
    { role: 'DIRECTOR', fullName: 'Omar Haddad', nationality: 'JO', dob: null, idType: 'passport', idNumberEnc: null, piiKeyId: null, idExpiry: null, ownershipPct: null, isPep: false, screeningStatus: 'CLEAR' },
  ],
  documents: [{ docType: 'trade_licence', fileName: 'licence.pdf', storageKey: 'cases/x/licence.pdf', sha256: 'a'.repeat(64), issuedOn: '2024-04-01', expiresOn: '2027-03-31', verifiedStatus: 'VERIFIED' }],
  case: { mongoCaseId: over.caseId ?? 'case-1', acquirerCode: 'EXAMPLE_ACQUIRER_A', status: 'COMPLETED', riskRating: 'LOW', decision: 'approve', decidedBy: 'uw@t.local', decidedAt: '2026-10-22T08:00:00.000Z', modelVersion: null, promptVersion: null },
  screening: [{ subject: 'Aisha Rahman', provider: 'MOCK_SCREENING', isMock: true, result: 'CLEAR', category: null, rawRef: 'mock:clear' }],
  token: { tokenHash: over.hash ?? 'h'.repeat(64), scopes: over.scopes ?? ['status', 'claim'], expiresAt: over.expiresAt ?? '2026-10-23T08:00:00.000Z', createdBy: 'uw@t.local' },
  audit: [{ actor: 'uw@t.local', action: 'case.completed', entity: 'case:case-1', ip: '127.0.0.1' }],
});

const NOW = new Date('2026-10-22T09:00:00Z');

const impls: [string, () => Promise<OnboardingRepository>][] = [
  ['memory', async () => createMemoryRepository()],
  ['mongo (collection fake)', async () => {
    const r = createMongoRepository(fakeRecordCollections().open);
    await r.migrate();
    return r;
  }],
];
if (process.env.MONGO_TEST_URL) {
  impls.push(['mongo (real server)', async () => {
    const url = process.env.MONGO_TEST_URL!.replace(/\/?(\?|$)/, `/mb_contract_${Date.now()}_${Math.round(Math.random() * 1e6)}$1`);
    const r = createMongoRepository(mongoRecordCollections(url));
    await r.migrate();
    return r;
  }]);
}

describe.each(impls)('system of record contract: %s', (_name, make) => {
  it('saves a completed onboarding and returns the same bundle', async () => {
    const repo = await make();
    expect(await repo.ping()).toBe(true);
    const ids = await repo.saveCompleted(record());
    expect(ids.partyIds).toHaveLength(2);
    expect(ids.documentIds).toHaveLength(1);
    const b = (await repo.getBundleByCase(ids.sqlCaseId))!;
    expect(b.merchant.id).toBe(ids.merchantId);
    expect(b.merchant.legalName).toBe('Desert Rose Trading FZCO');
    expect(b.merchant.expectedMonthlyVolume).toBe(250000);
    expect(b.parties.map((p) => p.fullName).sort()).toEqual(['Aisha Rahman', 'Omar Haddad']);
    expect(b.parties.find((p) => p.role === 'UBO')!.idNumberEnc).toBe('enc:abc');
    expect(b.documents[0].sha256).toBe('a'.repeat(64));
    expect(b.caseRow).toMatchObject({ id: ids.sqlCaseId, mongoCaseId: 'case-1', acquirerCode: 'EXAMPLE_ACQUIRER_A', decision: 'approve' });
    expect(b.screening[0]).toMatchObject({ isMock: true, result: 'CLEAR' });
    expect(await repo.getBundleByCase('nope')).toBeNull();
    await repo.close();
  });

  it('refuses to write the same case twice', async () => {
    const repo = await make();
    await repo.saveCompleted(record());
    await expect(repo.saveCompleted(record({ hash: 'x'.repeat(64) }))).rejects.toThrow(/already written/);
    await repo.close();
  });

  it('refuses a token hash collision', async () => {
    const repo = await make();
    await repo.saveCompleted(record());
    await expect(repo.saveCompleted(record({ caseId: 'case-2' }))).rejects.toThrow(/collision/);
    await repo.close();
  });

  it('keeps one merchant id per licence across re-onboardings', async () => {
    const repo = await make();
    const a = await repo.saveCompleted(record());
    const b = await repo.saveCompleted(record({ caseId: 'case-2', hash: 'y'.repeat(64) }));
    const c = await repo.saveCompleted(record({ caseId: 'case-3', hash: 'z'.repeat(64), licence: 'IFZA-999' }));
    expect(b.merchantId).toBe(a.merchantId);
    expect(c.merchantId).not.toBe(a.merchantId);
    expect(b.sqlCaseId).not.toBe(a.sqlCaseId);
    await repo.close();
  });

  it('finds tokens by hash (with hash) and by id (without hash)', async () => {
    const repo = await make();
    const ids = await repo.saveCompleted(record());
    const byHash = (await repo.findTokenByHash('h'.repeat(64)))!;
    expect(byHash).toMatchObject({ id: ids.tokenId, caseId: ids.sqlCaseId, merchantId: ids.merchantId, scopes: ['status', 'claim'], redeemedAt: null, revokedAt: null, tokenHash: 'h'.repeat(64) });
    expect(byHash.expiresAt).toBe('2026-10-23T08:00:00.000Z');
    const byId = (await repo.findTokenById(ids.tokenId))!;
    expect(byId.tokenHash).toBeUndefined();
    expect(await repo.findTokenByHash('missing')).toBeNull();
    await repo.close();
  });

  it('claims a token exactly once, even when two claims race', async () => {
    const repo = await make();
    await repo.saveCompleted(record());
    const [x, y] = await Promise.all([repo.claimToken('h'.repeat(64), NOW), repo.claimToken('h'.repeat(64), NOW)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const again = await repo.claimToken('h'.repeat(64), NOW);
    expect(again).toEqual({ ok: false, reason: 'redeemed' });
    expect((await repo.findTokenByHash('h'.repeat(64)))!.redeemedAt).toBe(NOW.toISOString());
    await repo.close();
  });

  it('explains why a claim failed: not found, expired, revoked, scope', async () => {
    const repo = await make();
    expect(await repo.claimToken('missing', NOW)).toEqual({ ok: false, reason: 'not_found' });
    await repo.saveCompleted(record({ caseId: 'c-exp', hash: 'e'.repeat(64), expiresAt: '2026-10-22T08:59:59.000Z' }));
    expect(await repo.claimToken('e'.repeat(64), NOW)).toEqual({ ok: false, reason: 'expired' });
    const rv = await repo.saveCompleted(record({ caseId: 'c-rev', hash: 'r'.repeat(64) }));
    expect(await repo.revokeToken(rv.tokenId, NOW)).toBe(true);
    expect(await repo.revokeToken(rv.tokenId, NOW)).toBe(false); // second revoke is a no-op
    expect(await repo.claimToken('r'.repeat(64), NOW)).toEqual({ ok: false, reason: 'revoked' });
    await repo.saveCompleted(record({ caseId: 'c-scope', hash: 's'.repeat(64), scopes: ['status'] }));
    expect(await repo.claimToken('s'.repeat(64), NOW)).toEqual({ ok: false, reason: 'scope' });
    expect(await repo.revokeToken('no-such-token', NOW)).toBe(false);
    await repo.close();
  });
});
