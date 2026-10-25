import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { TokenScope } from '@moneybee/shared';
import type { Logger } from '../logger';
import type { CaseBundle, ClaimOutcome, CompletedRecord, OnboardingRepository, SavedIds, SqlDocument, SqlMerchant, SqlParty, SqlScreening, TokenRow } from './repository';

/**
 * The few collection operations the repository needs. The MongoDB driver satisfies this directly;
 * tests use an in-memory implementation with the same query semantics.
 */
export interface RecordCollection {
  insertOne(doc: Record<string, unknown>): Promise<unknown>;
  findOne(filter: Record<string, unknown>): Promise<Record<string, any> | null>;
  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, opts: { upsert?: boolean; returnDocument: 'after' }): Promise<Record<string, any> | null>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ modifiedCount: number }>;
  createIndex(spec: Record<string, 1 | -1>, opts?: { unique?: boolean; name?: string }): Promise<unknown>;
}

export interface RecordCollections {
  /** one immutable document per completed onboarding: the commit point */
  records: RecordCollection;
  /** merchant identity (licence number + authority) and latest snapshot, derived from records */
  merchants: RecordCollection;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

interface StoredToken {
  id: string;
  hash: string;
  scopes: TokenScope[];
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  createdBy: string;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const merchantKey = (licenceNo: string, authority: string | null) => `${licenceNo.trim().toUpperCase()}|${(authority ?? '').trim().toUpperCase()}`;

function toTokenRow(rec: Record<string, any>, withHash: boolean): TokenRow {
  const t = rec.token as StoredToken;
  const row: TokenRow = {
    id: t.id,
    caseId: rec._id,
    merchantId: rec.merchantId,
    scopes: [...t.scopes],
    expiresAt: iso(t.expiresAt)!,
    redeemedAt: iso(t.redeemedAt),
    revokedAt: iso(t.revokedAt),
    createdBy: t.createdBy,
  };
  if (withHash) row.tokenHash = t.hash;
  return row;
}

/**
 * MongoDB system of record for completed onboardings (replaces SQL Server).
 *
 * Atomicity: the whole completed record (merchant snapshot, parties, documents, case decision, screening, token, audit)
 * is ONE document, written with a single insert. MongoDB guarantees a single-document write is atomic, so a completion is
 * either fully stored or not stored at all, with no replica set or multi-document transaction needed.
 * The merchants collection only holds identity (stable id per licence) and a derived latest snapshot.
 */
export function createMongoRepository(open: () => Promise<RecordCollections>, log?: Logger): OnboardingRepository {
  let cols: RecordCollections | null = null;
  const c = async () => (cols ??= await open());

  return {
    async migrate() {
      const { records, merchants } = await c();
      await records.createIndex({ mongoCaseId: 1 }, { unique: true, name: 'uniq_case' });
      await records.createIndex({ 'token.hash': 1 }, { unique: true, name: 'uniq_token_hash' });
      await records.createIndex({ 'token.id': 1 }, { unique: true, name: 'uniq_token_id' });
      await records.createIndex({ merchantId: 1, completedAt: -1 }, { name: 'merchant_records' });
      await merchants.createIndex({ key: 1 }, { unique: true, name: 'uniq_licence' });
      log?.info('onboarding record indexes ready (MongoDB)');
    },

    async ping() {
      try {
        return await (await c()).ping();
      } catch {
        return false;
      }
    },

    async saveCompleted(rec: CompletedRecord): Promise<SavedIds> {
      const { records, merchants } = await c();
      const m = rec.merchant;
      const key = merchantKey(m.licenceNo, m.licenceAuthority);
      const now = new Date();

      // 1. Stable merchant id for this licence. Only identity is written here ($setOnInsert), never data,
      //    so a failed completion below leaves no business data behind.
      const ident = await merchants.findOneAndUpdate(
        { key },
        { $setOnInsert: { _id: randomUUID(), key, licenceNo: m.licenceNo, licenceAuthority: m.licenceAuthority, createdAt: now } },
        { upsert: true, returnDocument: 'after' },
      );
      const merchantId = String(ident!._id);

      // 2. The commit point: one document, one atomic insert. Unique indexes reject a second completion of the same case
      //    and any token hash collision.
      const recordId = randomUUID();
      const tokenId = randomUUID();
      const parties: SqlParty[] = rec.parties.map((p) => ({ id: randomUUID(), ...p }));
      const documents: SqlDocument[] = rec.documents.map((d) => ({ id: randomUUID(), ...d }));
      const token: StoredToken = {
        id: tokenId,
        hash: rec.token.tokenHash,
        scopes: [...rec.token.scopes],
        expiresAt: new Date(rec.token.expiresAt),
        redeemedAt: null,
        revokedAt: null,
        createdBy: rec.token.createdBy,
      };
      try {
        await records.insertOne({
          _id: recordId,
          mongoCaseId: rec.case.mongoCaseId,
          merchantId,
          merchant: { id: merchantId, ...m },
          parties,
          documents,
          case: rec.case,
          screening: rec.screening,
          token,
          audit: rec.audit.map((a) => ({ ...a, at: now })),
          completedAt: now,
        });
      } catch (e) {
        const code = (e as { code?: number }).code;
        if (code === 11000) {
          const msg = String((e as Error).message ?? '');
          throw new Error(msg.includes('token') ? 'token hash collision' : 'case already written (unique constraint)');
        }
        throw e;
      }

      // 3. Derived latest snapshot of the merchant (idempotent; the record above is the source of truth).
      await merchants.updateOne({ _id: merchantId }, { $set: { ...m, latestRecordId: recordId, updatedAt: now } });

      return { merchantId, sqlCaseId: recordId, tokenId, partyIds: parties.map((p) => p.id), documentIds: documents.map((d) => d.id) };
    },

    async findTokenByHash(hash) {
      const r = await (await c()).records.findOne({ 'token.hash': hash });
      return r ? toTokenRow(r, true) : null;
    },

    async findTokenById(id) {
      const r = await (await c()).records.findOne({ 'token.id': id });
      return r ? toTokenRow(r, false) : null;
    },

    async claimToken(hash, now): Promise<ClaimOutcome> {
      const { records } = await c();
      // Single atomic update: redeems only if unredeemed, unrevoked, unexpired and scoped for claim. At most one caller wins.
      const won = await records.findOneAndUpdate(
        { 'token.hash': hash, 'token.scopes': 'claim', 'token.redeemedAt': null, 'token.revokedAt': null, 'token.expiresAt': { $gt: now } },
        { $set: { 'token.redeemedAt': now } },
        { returnDocument: 'after' },
      );
      if (won) return { ok: true, token: toTokenRow(won, false) };
      const r = await records.findOne({ 'token.hash': hash });
      if (!r) return { ok: false, reason: 'not_found' };
      const t = r.token as StoredToken;
      if (!t.scopes.includes('claim')) return { ok: false, reason: 'scope' };
      if (t.revokedAt) return { ok: false, reason: 'revoked' };
      if (new Date(t.expiresAt) <= now) return { ok: false, reason: 'expired' };
      return { ok: false, reason: 'redeemed' };
    },

    async revokeToken(id, now) {
      const res = await (await c()).records.updateOne({ 'token.id': id, 'token.revokedAt': null }, { $set: { 'token.revokedAt': now } });
      return res.modifiedCount > 0;
    },

    async getBundleByCase(recordId): Promise<CaseBundle | null> {
      const r = await (await c()).records.findOne({ _id: recordId });
      if (!r) return null;
      const merchant = r.merchant as SqlMerchant;
      return {
        merchant: { ...merchant, id: r.merchantId },
        parties: (r.parties as SqlParty[]).map((p) => ({ ...p })),
        documents: (r.documents as SqlDocument[]).map((d) => ({ ...d })),
        caseRow: {
          id: r._id,
          mongoCaseId: r.mongoCaseId,
          acquirerCode: r.case.acquirerCode,
          status: r.case.status,
          riskRating: r.case.riskRating ?? null,
          decision: r.case.decision ?? null,
          decidedBy: r.case.decidedBy ?? null,
          decidedAt: iso(r.case.decidedAt),
        },
        screening: (r.screening as SqlScreening[]).map((s) => ({ ...s })),
      };
    },

    async close() {
      await cols?.close();
      cols = null;
    },
  };
}

/** Production wiring: its own MongoDB connection (the driver bundled with mongoose), so it works whatever STORE is. */
export function mongoRecordCollections(url: string): () => Promise<RecordCollections> {
  return async () => {
    const client = new mongoose.mongo.MongoClient(url, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db();
    return {
      records: db.collection('onboarding_records') as unknown as RecordCollection,
      merchants: db.collection('merchants') as unknown as RecordCollection,
      async ping() {
        const r = await db.command({ ping: 1 });
        return r.ok === 1;
      },
      async close() {
        await client.close();
      },
    };
  };
}
